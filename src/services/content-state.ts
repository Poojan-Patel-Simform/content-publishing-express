import { VersionStatus } from "../generated/prisma-client/enums.js";
import { ConflictError } from "../errors/http-errors.js";

/**
 * The one place `ContentVersion` transitions are legal or not (plan.md §2).
 * Controllers and services never branch on status themselves -- they call
 * `assertTransition` and let the 409 stop the write before it happens.
 */
const TRANSITIONS: Record<VersionStatus, VersionStatus[]> = {
  [VersionStatus.DRAFT]: [VersionStatus.PENDING_REVIEW, VersionStatus.DISCARDED],
  [VersionStatus.PENDING_REVIEW]: [VersionStatus.APPROVED, VersionStatus.REJECTED],
  [VersionStatus.REJECTED]: [VersionStatus.PENDING_REVIEW],
  [VersionStatus.APPROVED]: [VersionStatus.PUBLISHED, VersionStatus.SCHEDULED],
  [VersionStatus.SCHEDULED]: [VersionStatus.PUBLISHED, VersionStatus.APPROVED],
  [VersionStatus.PUBLISHED]: [VersionStatus.SUPERSEDED, VersionStatus.UNPUBLISHED],
  [VersionStatus.UNPUBLISHED]: [VersionStatus.PUBLISHED],
  [VersionStatus.SUPERSEDED]: [],
  [VersionStatus.DISCARDED]: [],
};

/** Versions editable in place -- everything else is immutable (plan.md §2). */
export const EDITABLE_VERSION_STATUSES: VersionStatus[] = [
  VersionStatus.DRAFT,
  VersionStatus.REJECTED,
];

export const canTransition = (current: VersionStatus, target: VersionStatus): boolean =>
  TRANSITIONS[current].includes(target);

export const assertTransition = (current: VersionStatus, target: VersionStatus): void => {
  if (!canTransition(current, target)) {
    throw new ConflictError(`Cannot move a version from ${current} to ${target}`);
  }
};

export const assertEditable = (current: VersionStatus): void => {
  if (!EDITABLE_VERSION_STATUSES.includes(current)) {
    throw new ConflictError(`Version is ${current} and can no longer be edited`);
  }
};
