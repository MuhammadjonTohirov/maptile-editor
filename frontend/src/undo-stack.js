// A bounded stack of inverse API operations. Taking an entry is separate from
// discarding it so a transient failed undo can be retried instead of being lost.
export class UndoStack {
  constructor(limit = 50) {
    this.limit = limit;
    this.entries = [];
  }

  push(revert, { roadMutation = false } = {}) {
    this.entries.push({ revert, roadMutation });
    if (this.entries.length > this.limit) this.entries.shift();
  }

  take() {
    return this.entries.pop();
  }

  restore(entry) {
    if (entry) this.entries.push(entry);
  }

  get length() {
    return this.entries.length;
  }
}
