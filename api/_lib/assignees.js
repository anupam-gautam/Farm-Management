// Task assignee helpers — supports one or many workers per task.
// Keeps assigned_account_id (first assignee) for backward compatibility.

/** Parse assignee ids from an API request body. */
export function assigneeIdsFromBody(body) {
  const raw = body?.assignedAccountIds ?? body?.assigned_account_ids;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(String).filter(Boolean))];
  }
  if (body?.assignedAccountId) return [String(body.assignedAccountId)];
  if (body?.assigned_account_id) return [String(body.assigned_account_id)];
  return [];
}

/** Normalize stored task rows to always expose both fields. */
export function normalizeTaskAssignees(task) {
  if (!task) return task;
  const fromArray = Array.isArray(task.assigned_account_ids)
    ? task.assigned_account_ids.map(String).filter(Boolean)
    : [];
  const ids = fromArray.length
    ? [...new Set(fromArray)]
    : (task.assigned_account_id ? [String(task.assigned_account_id)] : []);
  return {
    ...task,
    assigned_account_ids: ids,
    assigned_account_id: ids[0] ?? task.assigned_account_id ?? null,
  };
}

/** Build storage fields from a list of account ids. */
export function assigneeFieldsFromIds(ids) {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  return {
    assigned_account_ids: unique,
    assigned_account_id: unique[0] ?? null,
  };
}

/** Whether a worker account is assigned to this task. */
export function isAssignedTo(task, accountId) {
  if (!task || !accountId) return false;
  const ids = task.assigned_account_ids?.length
    ? task.assigned_account_ids
    : (task.assigned_account_id ? [task.assigned_account_id] : []);
  return ids.includes(accountId);
}
