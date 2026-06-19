const logBuffer = [];

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function formatArgs(args) {
    return args.map(a => {
        if (a instanceof Error) return a.stack;
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
}

console.log = function(...args) {
    const msg = `[INFO] ${new Date().toISOString()} - ${formatArgs(args)}`;
    logBuffer.push(msg);
    if(logBuffer.length > 1000) logBuffer.shift();
    originalLog.apply(console, args);
};

console.warn = function(...args) {
    const msg = `[WARN] ${new Date().toISOString()} - ${formatArgs(args)}`;
    logBuffer.push(msg);
    if(logBuffer.length > 1000) logBuffer.shift();
    originalWarn.apply(console, args);
};

console.error = function(...args) {
    const msg = `[ERROR] ${new Date().toISOString()} - ${formatArgs(args)}`;
    logBuffer.push(msg);
    if(logBuffer.length > 1000) logBuffer.shift();
    originalError.apply(console, args);
};

module.exports = {
    getLogs: () => logBuffer
};
