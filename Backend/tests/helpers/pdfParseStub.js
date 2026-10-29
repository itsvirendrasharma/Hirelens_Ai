// Stand-in for pdf-parse used by upload.flow.test.js to exercise the real extractText() error handling without a PDF library.
module.exports = async function pdfParseStub() {
  const behaviour = global.__PDF_STUB__ || {};
  if (behaviour.throws) { const e = new Error(behaviour.throws.message); e.name = behaviour.throws.name || 'Error'; throw e; }
  return { text: behaviour.text || '' };
};
