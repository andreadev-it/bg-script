export class Error {

    /**
     * Creates a new Error with a specific id and a function that will return useful informations
     */
    constructor(
        public id: string, 
        public getTextCallback: (...args: any[]) => string
    ) {}

    /**
     * Get the error description text
     */
    getText(...args: any[]) {
        return this.getTextCallback(...args);
    }
}

export const BgHandlerErrors = {
    ID_TAKEN: new Error('ID_TAKEN', (id) => `The id '${id}' has already been taken. It must be unique.` ),
    NO_CONNECTION: new Error('NO_CONNECTION', (scriptId, tabId) => `There is no connection assigned to id '${scriptId}'${(tabId) ? ` connected to the tab ${tabId}` : ''}.`)
};
