export class EngagementNotFoundError extends Error {
  constructor(taskId?: string) {
    super(taskId ? `Engagement not found: ${taskId}` : "Engagement not found");
    this.name = "EngagementNotFoundError";
  }
}

export class EngagementStateError extends Error {
  readonly currentStatus: string;

  constructor(message: string, currentStatus: string) {
    super(message);
    this.name = "EngagementStateError";
    this.currentStatus = currentStatus;
  }
}

export class DuplicateEngagementError extends Error {
  constructor(taskId: string) {
    super(`Engagement already exists for task_id: ${taskId}`);
    this.name = "DuplicateEngagementError";
  }
}

export class EvidenceRequiredError extends Error {
  constructor(taskId: string) {
    super(
      `Accept blocked: signed task_deliverable evidence required for task_id ${taskId}`
    );
    this.name = "EvidenceRequiredError";
  }
}

export class EvidenceMismatchError extends Error {
  constructor() {
    super("Deliverable evidence does not match engagement worker or task");
    this.name = "EvidenceMismatchError";
  }
}
