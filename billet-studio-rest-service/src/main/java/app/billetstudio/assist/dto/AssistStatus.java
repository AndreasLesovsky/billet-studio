package app.billetstudio.assist.dto;

/**
 * READY: the model is loaded. IDLE: it is there but not loaded, so the first answer waits for it. OFFLINE: the model
 * server does not answer or lacks the model. DISABLED: the assistant is switched off in this deployment.
 */
public enum AssistStatus {
    READY, IDLE, OFFLINE, DISABLED
}
