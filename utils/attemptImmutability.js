const IMMUTABLE_FIELDS = ['quizStartedAt', 'lockedDeviceHash', 'eligibilitySnapshot'];

export function guardAttemptImmutability(doc) {
  if (doc.isNew) return;
  for (const field of IMMUTABLE_FIELDS) {
    if (doc.isModified(field)) {
      throw new Error(`Cannot modify immutable field: ${field}`);
    }
  }
}
