export const queueMicrotask = (callback) => {
    if (globalThis.queueMicrotask) {
        globalThis.queueMicrotask(callback);
        return;
    }
    
    if (Promise !== undefined) {
        Promise.resolve().then(callback);
        return;
    }
    
    throw "This browser does not support adding microtasks";
}

export const queueTask = (callback) => {
    setTimeout(callback);
}
    
