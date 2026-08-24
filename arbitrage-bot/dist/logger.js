function ts() {
    return new Date().toISOString();
}
export const logger = {
    info: (msg, ...rest) => console.log(`[${ts()}] INFO  ${msg}`, ...rest),
    warn: (msg, ...rest) => console.warn(`[${ts()}] WARN  ${msg}`, ...rest),
    error: (msg, ...rest) => console.error(`[${ts()}] ERROR ${msg}`, ...rest),
};
