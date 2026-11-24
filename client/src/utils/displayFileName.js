// User-visible file labels only. Repairs UTF-8 bytes that were previously stored as Latin-1.
export function displayFileName(value) {
  const name = String(value ?? '')
  if (!/[\u0080-\u00ff]/.test(name)) return name.normalize('NFC')

  try {
    const encoded = Array.from(name, (char) => {
      const code = char.charCodeAt(0)
      if (code > 255) throw new Error('not a Latin-1 byte string')
      return `%${code.toString(16).padStart(2, '0')}`
    }).join('')
    const repaired = decodeURIComponent(encoded)
    if (!repaired || repaired.includes('\ufffd')) return name
    return repaired.normalize('NFC')
  } catch {
    return name
  }
}
