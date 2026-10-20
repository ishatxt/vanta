function snapshotKey(snapshot) {
  try {
    return JSON.stringify(snapshot);
  } catch {
    return "";
  }
}

function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

export class History {
  constructor(limit = 60) {
    this.limit = Math.max(2, limit);
    this.entries = [];
    this.index = -1;
    this.lastKey = "";
  }

  reset(snapshot) {
    this.entries = [cloneSnapshot(snapshot)];
    this.index = 0;
    this.lastKey = snapshotKey(snapshot);
  }

  commit(snapshot, { force = false } = {}) {
    const key = snapshotKey(snapshot);
    if (!key) return false;
    if (!force && key === this.lastKey) return false;

    if (this.index < this.entries.length - 1) {
      this.entries.splice(this.index + 1);
    }

    this.entries.push(cloneSnapshot(snapshot));
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    this.index = this.entries.length - 1;
    this.lastKey = key;
    return true;
  }

  undo() {
    if (this.index <= 0) return null;
    this.index -= 1;
    const snapshot = cloneSnapshot(this.entries[this.index]);
    this.lastKey = snapshotKey(snapshot);
    return snapshot;
  }

  redo() {
    if (this.index >= this.entries.length - 1) return null;
    this.index += 1;
    const snapshot = cloneSnapshot(this.entries[this.index]);
    this.lastKey = snapshotKey(snapshot);
    return snapshot;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  get size() {
    return this.entries.length;
  }
}
