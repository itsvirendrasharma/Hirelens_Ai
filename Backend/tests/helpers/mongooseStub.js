// Minimal stand-in for `mongoose`, used ONLY by upload.flow.test.js when mongoose is not installed (e.g. a sandbox).
class ObjectId { constructor(v) { this.v = String(v); } toString() { return this.v; } static createFromHexString(v) { return new ObjectId(v); } }
module.exports = { isValidObjectId: (s) => /^[a-f\d]{24}$/i.test(String(s)), Types: { ObjectId }, Schema: class Schema {}, model() {}, models: {}, set() {} };
