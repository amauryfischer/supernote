// Shared notification types — usable on both main and renderer processes.

export type NotificationLevel = "info" | "success" | "warning" | "danger";

export interface NotificationAction {
  label: string;
  commandId?: string;
  url?: string;
}

export interface NotificationEntityRef {
  id: string;
  type: string;
}

export interface NotificationPayload {
  readonly id: string;
  readonly level: NotificationLevel;
  readonly title: string;
  readonly body?: string;
  readonly icon?: string;
  /** Origin of the notification, e.g. 'automation', 'sync', 'plugin'. */
  readonly source?: string;
  /** ISO 8601 date string. */
  readonly createdAt: string;
  readAt?: string;
  readonly actions?: NotificationAction[];
  readonly entityRef?: NotificationEntityRef;
  /** ISO 8601 date string — notification expires after this date. */
  readonly expiresAt?: string;
  /** When true, also trigger an OS-level notification. */
  readonly os?: boolean;
  /** When true, suppress sound/banner on OS notification. */
  readonly silent?: boolean;
}

export type NotificationFilter = {
  unread?: boolean;
  limit?: number;
};

export type NotificationEvent = "notification";

export type NotificationListener = (notification: NotificationPayload) => void;
