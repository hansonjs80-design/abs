// Keep a complete edit (including range writes and its undo record) in order.
export function createPatientHistoryMutationQueue() {
  let tail = Promise.resolve();
  let generation = 0;
  let activeGeneration = null;
  return {
    enqueue(task) {
      const scheduledGeneration = generation;
      const result = tail.then(async () => {
        if (scheduledGeneration !== generation) return false;
        activeGeneration = scheduledGeneration;
        try {
          return await task();
        } finally {
          activeGeneration = null;
        }
      });
      tail = result.catch(() => {});
      return result;
    },
    reset() { generation += 1; },
    isCurrent() { return activeGeneration === null || activeGeneration === generation; },
  };
}

export function updatePatientHistoryDraft(editor, value) {
  const nextValue = String(value ?? '');
  if (!editor || editor.value === nextValue) return editor;
  return {
    ...editor,
    value: nextValue,
    undoValues: [...(editor.undoValues || []), editor.value].slice(-100),
  };
}

export function undoPatientHistoryDraft(editor) {
  if (!editor?.undoValues?.length) return null;
  return {
    ...editor,
    value: editor.undoValues.at(-1),
    undoValues: editor.undoValues.slice(0, -1),
  };
}
