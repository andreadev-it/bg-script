export interface Runtime {
    onConnect: {
        addListener(callback: (port: chrome.runtime.Port) => void): void
    }
    onMessage: {
        addListener(callback: (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => void): void
    }
    connect: (options: { name: string }) => chrome.runtime.Port
}

export interface Storage {
    local: {
        set(data: object): Promise<void>,
        get(data: object | string | string[]): Promise<any>
    }
}

export interface ChromeTabs {
    sendMessage(tabId: number, message: object): Promise<void>
}

export function waitForNextTask() : Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
