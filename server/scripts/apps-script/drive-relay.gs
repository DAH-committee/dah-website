/**
 * drive-relay.gs — DAH 웹사이트 ↔ Google Drive 수신 스크립트 (53_DRIVE_STORAGE)
 *
 * 이 스크립트는 사람이 보는 화면이 아니다. 학생은 사이트의 접수 폼(/forms/...)에서만 제출하고,
 * 사이트 서버가 이 웹앱으로 파일을 보내 Drive에 저장한다.
 *   제출자 브라우저 → dah-website 서버 → (이 웹앱) → 배포한 사람의 Google Drive
 *
 * 왜 쓰는가: Google Cloud 콘솔에서 OAuth 클라이언트를 만들지 않아도 된다. 웹앱을 "나로 실행"으로
 * 배포하면 배포한 사람 권한으로 Drive에 쓰기 때문이다.
 *
 * ── 배포 순서 (다음 운영진도 이 순서만 따르면 된다) ─────────────────────────
 * 1. 파일을 보관할 Google 계정으로 https://script.google.com 접속 → 새 프로젝트
 * 2. 이 파일 내용을 전부 붙여넣고, 아래 SHARED_SECRET 값을 새 임의 문자열(32자 이상)로 바꾼다.
 * 3. 저장 → 배포 → 새 배포 → 유형 "웹 앱"
 *      - 설명: DAH Drive Relay
 *      - 다음 사용자로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자     ← 반드시 이 설정
 * 4. 배포하면 나오는 .../exec 주소를 복사한다.
 * 5. 사이트 관리 → 저장소 · Google Drive → "Apps Script 연결 추가"에 주소와 2번의 비밀키를 넣는다.
 * 6. "연결 점검"을 눌러 계정 이메일과 루트 폴더가 보이면 끝이다.
 *
 * ── 접수 확인 메일과 매일 백업 (같은 스크립트가 함께 처리한다) ─────────────
 * 이 두 기능을 쓰려면 위 배포 순서의 3번에서 "새 버전"으로 다시 배포하고, 권한 승인 창에서
 * 메일 보내기, 스프레드시트, 외부 요청 권한을 허용한다. 배포 주소(.../exec)는 바뀌지 않는다.
 * 1. 접수 확인 메일: 사이트가 이 웹앱의 sendMail을 부른다. 보내는 사람은 이 스크립트를 배포한 계정이고,
 *    하루 한도는 일반 구글 계정 100명, Workspace 계정 1,500명(MailApp 할당량)이다. 한도를 다 쓰면
 *    그날은 메일만 건너뛰고 접수는 정상이다.
 * 2. 매일 백업: 편집기에서 installBackupTrigger 함수를 한 번 실행하면 매일 새벽 3시에 backupToSheet가
 *    사이트의 /relay/backup을 불러 'DAH 접수 백업' 스프레드시트를 갱신한다(전시회 접수 1장, 폼마다 1장).
 *    지금 바로 해 보려면 backupToSheet를 직접 실행한다.
 *
 * 비밀키는 사이트 서버가 암호화해 보관하고, 화면이나 API 응답에 다시 나오지 않는다.
 * 이 스크립트 코드는 GitHub에 올라가므로 SHARED_SECRET 자리에 실제 값을 남기지 않는다.
 */

// 배포할 때 각자 바꾼다. 사이트에 등록한 값과 한 글자도 다르면 모든 요청이 401로 거부된다.
var SHARED_SECRET = 'CHANGE_ME_배포할_때_임의의_32자_이상_문자열로_교체';

// 매일 접수 백업을 가져올 사이트 주소. 사이트 서버 주소(Render)를 넣는다.
var SITE_URL = 'https://dah-website-72a4.onrender.com';

var FOLDER_MIME = 'application/vnd.google-apps.folder';

function doGet() {
  // 사람이 주소를 열어보면 상태만 알려준다. 여기서 업무 화면을 제공하지 않는다.
  return json({ ok: true, service: 'dah-drive-relay', note: '이 주소는 사이트 서버 전용 수신처입니다.' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ error: '요청 본문을 읽을 수 없습니다.', status: 400 });
  }

  if (!body.secret || body.secret !== SHARED_SECRET) {
    return json({ error: '비밀키가 일치하지 않습니다.', status: 401 });
  }

  try {
    switch (body.action) {
      case 'about':
        return json(about());
      case 'list':
        return json({ files: listFolders(body.parentId, body.name) });
      case 'createFolder':
        return json(createFolder(body.parentId, body.name));
      case 'upload':
        return json(upload(body));
      case 'get':
        return json(getMeta(body.fileId));
      case 'share':
        return json(share(body.fileId, body.type, body.role));
      case 'trash':
        return json(trash(body.fileId));
      case 'createSheet':
        return json(createSheet(body));
      case 'sendMail':
        return json(sendMail(body));
      default:
        return json({ error: '알 수 없는 action입니다: ' + body.action, status: 400 });
    }
  } catch (err) {
    var message = String((err && err.message) || err);
    // 권한·존재 여부 오류는 사이트가 구분해 안내할 수 있게 상태 코드를 붙여 돌려준다.
    var status = /not found|찾을 수 없|No item|없습니다/i.test(message) ? 404
      : /permission|권한/i.test(message) ? 403
      : 500;
    return json({ error: message, status: status });
  }
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function about() {
  var email = Session.getEffectiveUser().getEmail();
  return {
    user: { emailAddress: email, displayName: email },
    storageQuota: {
      limit: String(DriveApp.getStorageLimit()),
      usage: String(DriveApp.getStorageUsed()),
    },
  };
}

function folderById(id) {
  if (!id) throw new Error('폴더 ID가 없습니다.');
  if (id === 'root') return DriveApp.getRootFolder();
  return DriveApp.getFolderById(id);
}

/** 같은 이름의 하위 폴더 목록(휴지통 제외). 오래된 것부터 — 사이트가 첫 폴더를 승자로 고른다 */
function listFolders(parentId, name) {
  if (!parentId || !name) return [];
  var parent = folderById(parentId);
  var it = parent.getFoldersByName(name);
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    out.push({ id: f.getId(), name: f.getName(), createdTime: f.getDateCreated().toISOString() });
  }
  out.sort(function (a, b) { return a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : 0; });
  return out;
}

function createFolder(parentId, name) {
  var parent = folderById(parentId);
  var folder = parent.createFolder(String(name));
  return { id: folder.getId(), name: folder.getName(), createdTime: folder.getDateCreated().toISOString() };
}

/** 원본 바이트를 그대로 저장한다. 변환·리사이즈·이름 변경을 하지 않는다 */
function upload(body) {
  var parent = folderById(body.parentId);
  var bytes = Utilities.base64Decode(body.dataBase64 || '');
  var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', String(body.name || 'file'));
  var file = parent.createFile(blob);
  if (body.description) file.setDescription(body.description);
  else if (body.appProperties && body.appProperties.originalName) {
    file.setDescription('원본 파일명: ' + body.appProperties.originalName);
  }
  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: String(file.getSize()),
    webViewLink: file.getUrl(),
  };
}

function getMeta(fileId) {
  if (!fileId) throw new Error('파일 ID가 없습니다.');
  var folder = null;
  try {
    folder = fileId === 'root' ? DriveApp.getRootFolder() : DriveApp.getFolderById(fileId);
  } catch (err) {
    folder = null;
  }
  if (folder) {
    return {
      id: folder.getId(),
      name: folder.getName(),
      mimeType: FOLDER_MIME,
      trashed: folder.isTrashed(),
      webViewLink: folder.getUrl(),
      capabilities: { canAddChildren: true, canEdit: true },
    };
  }
  var file = DriveApp.getFileById(fileId); // 없으면 여기서 예외 → 404로 변환된다
  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    trashed: file.isTrashed(),
    webViewLink: file.getUrl(),
    capabilities: { canAddChildren: false, canEdit: true },
  };
}

/** 기본은 제한 공유다. 사이트에서 "링크 보기 허용"을 고른 파일만 이 함수가 호출된다 */
function share(fileId, type, role) {
  var file = DriveApp.getFileById(fileId);
  if (type === 'anyone') {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, role === 'writer' ? DriveApp.Permission.EDIT : DriveApp.Permission.VIEW);
  }
  return { ok: true, id: fileId };
}

/** 삭제는 사이트 관리자가 명시적으로 요청할 때만 호출된다(휴지통으로 이동) */
function trash(fileId) {
  DriveApp.getFileById(fileId).setTrashed(true);
  return { ok: true, id: fileId };
}

/**
 * 관리자 시트를 새 구글 시트로 만든다. 이 동작을 쓰려면 릴레이를 새 버전으로 다시 배포하고
 * 스프레드시트 권한 승인 창에서 허용해야 한다.
 */
function createSheet(body) {
  var values = body.values || [];
  var ss = SpreadsheetApp.create(String(body.name || '접수 현황'));
  var sheet = ss.getSheets()[0];
  if (values.length && values[0].length) {
    sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold');
  }
  if (body.parentId) {
    var file = DriveApp.getFileById(ss.getId());
    DriveApp.getFolderById(body.parentId).addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }
  return { id: ss.getId(), url: ss.getUrl() };
}

/**
 * 접수 확인 메일 1통. 하루 한도가 남아 있을 때만 보낸다.
 * 한도를 다 쓰면 오류 대신 skipped를 돌려줘서 사이트가 접수를 그대로 마치게 한다.
 */
function sendMail(body) {
  if (!body.to) throw new Error('받는 사람이 없습니다.');
  var left = MailApp.getRemainingDailyQuota();
  if (left < 1) return { skipped: 'quota', remaining: left };
  MailApp.sendEmail({
    to: String(body.to),
    subject: String(body.subject || '접수 안내'),
    body: String(body.body || ''),
    name: String(body.name || '한림대학교 디지털인문예술전공')
  });
  return { ok: true, remaining: left - 1 };
}

// ── 매일 백업 ─────────────────────────────────────────────────────

/** 백업 스프레드시트를 찾고, 없으면 새로 만든다(ID는 스크립트 속성에 둔다) */
function backupSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* 지워졌으면 새로 만든다 */ }
  }
  var ss = SpreadsheetApp.create('DAH 접수 백업');
  props.setProperty('BACKUP_SHEET_ID', ss.getId());
  return ss;
}

/** 시트 이름은 100자 이하이고 일부 기호를 못 쓴다 */
function safeSheetName(name) {
  return String(name).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 90) || '시트';
}

function writeTable(ss, table) {
  var name = safeSheetName(table.name);
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  var values = [table.header].concat(table.rows);
  var width = table.header.length;
  sheet.getRange(1, 1, values.length, width).setValues(values.map(function (r) {
    var row = r.slice(0, width);
    while (row.length < width) row.push('');
    return row;
  }));
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  return name;
}

/** 사이트의 접수 자료를 가져와 백업 시트를 갱신한다. 매일 트리거가 부르고, 직접 실행해도 된다 */
function backupToSheet() {
  var res = UrlFetchApp.fetch(SITE_URL + '/relay/backup', {
    headers: { 'X-Relay-Secret': SHARED_SECRET },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('백업 자료를 받지 못했습니다 (' + res.getResponseCode() + '). SITE_URL과 연결 비밀키를 확인하세요.');
  }
  var data = JSON.parse(res.getContentText());
  var ss = backupSpreadsheet();
  var kept = [];
  var counts = [];
  data.tables.forEach(function (t) {
    kept.push(writeTable(ss, t));
    counts.push(t.name + ' ' + t.rows.length + '건');
  });
  var log = ss.getSheetByName('백업 기록') || ss.insertSheet('백업 기록');
  if (log.getLastRow() === 0) log.appendRow(['백업 시각', '내용']);
  log.appendRow([new Date(), counts.join(', ')]);
  // 새 스프레드시트가 기본으로 가진 빈 시트는 정리한다
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  return ss.getUrl();
}

/** 한 번만 실행한다. 매일 새벽 3시 백업을 예약한다(이미 있으면 새로 갈아 끼운다) */
function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupToSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupToSheet').timeBased().everyDays(1).atHour(3).create();
}
