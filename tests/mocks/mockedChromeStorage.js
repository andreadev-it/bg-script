class Storage {
    data = new Map();

    async get(keys) {
        let result = new Map();
        for (let key of keys) {
            result.set(key, this.data.get(key));
        }
        return result;
    }

    async set(entries) {
        for (let [key, value] of Object.entries(entries)) {
            this.data.set(key, value);
        }
    }
}

export class MockedChromeStorage {
    local = new Storage();
}
