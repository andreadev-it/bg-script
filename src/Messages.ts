/** It contains all the message types values to be used in the code */
export enum MessageTypes {
    BOOTSTRAP = "bootstrap",  // initialization message
    BOOTSTRAPANSWER = "bootstrap-answer", // answer to the bootstrap message (to avoi conflict)
    REQUESTID = "request-id", // get the id associated with the script
    GET = "get",              // get an exposed property value
    SET = "set",              // set an exposed property value
    CALL = "call",            // call an exposed method
    ANSWER = "answer",        // receive the answer after calling an exposed method
    ERROR = "error"           // the exposed method call resulted in an error
}

export type Message = BootstrapMessage
    | BootstrapAnswerMessage
    | SetPropertyMessage
    | GetPropertyMessage
    | CallMethodMessage
    | AnswerMessage
    | RequestIdMessage
    | ErrorMessage;

export type BootstrapMessage = {
    type: MessageTypes.BOOTSTRAP;
    id: number;
    exposedMethods: string[];
}

export type BootstrapAnswerMessage = {
    type: MessageTypes.BOOTSTRAPANSWER;
    id: number;
    exposedMethods: string[];
}

export type SetPropertyMessage = {
    type: MessageTypes.SET;
    id: number;
    prop: string;
    value: any;
}

export type GetPropertyMessage = {
    type: MessageTypes.GET;
    id: number;
    prop: string;
}

export type CallMethodMessage = {
    type: MessageTypes.CALL;
    id: number;
    name: string;
    args: any[];
}

export type AnswerMessage = {
    type: MessageTypes.ANSWER;
    id: number;
    result: any;
}

export type RequestIdMessage = {
    type: MessageTypes.REQUESTID;
    id: number;
}

export type ErrorMessage = {
    type: MessageTypes.ERROR;
    id: number;
    error: any;
}
