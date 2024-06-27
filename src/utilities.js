export function waitForNextTask() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
