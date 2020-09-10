# bg-script - Library for chrome extension communication
This library will help you communicate between your content scripts and the background script, offering an alternative to the default `sendMessage` API. The
problem with the original API is that it is not very easy to use in different parts of your code, and doesn't allow you to easily get response for asynchronous
actions.

This project was inspired by comlink, and it started out as a way for me to better understand Javascript Proxies.

## How does it work?

In your background script, you must create a BackgroundHandler class and pass it an object that contains the property and methods that you want to share:

```js
// background.js

function remoteFunction() {
  return "Executed remotely";
}

let bgHandler = new BackgroundHandler({
  remoteFunction // This is a shorthand for `remoteFunction: remoteFunction`
});

```

In your content script, you should create a BackgroundScript class and then use it in this way:

```js
var bgScript = new BackgroundScript();

async function foo() {
   // Get a reference to the background script connection (which is a proxy)
   let connection = await bgScript.getConnection();
   
   let result = await bgScript.remoteFunction();
   console.log(result); // --> "Executed remotely"
   
}
```

## Installation

Download the `bgscript.js` file and include it in your chrome extension in the following two ways.

In order to use it in your content scripts, include it in your manifest.json as the first content script:

```
"content_scripts": [{
  "js": ["bgscript.js", "my-content-script.js", ...]
}]
```

Similarly, you need to declare it as first script in the "background scripts" section of your manifest file:

```
"background": {
  "scripts": [ "bgscript.js", "my-background-script.js"]
}
```

When you do this, the two classes will be automatically available in your scripts.

If you're building an html page for your extension, just add the following tag to the head of your page, before any other script.
```html
<script src='bgscript.js'></script>
```

## How to use it

### Get a variable from the background script

Background script:
```js
let shared = {
  variable: 10
}

// This function shows how to use shared variables within the script to avoid problems with object references
function setVariable(val) {
  shared.variable = val;
}

// Initialize the Background script handler passing the object to be shared
let bgHandler = new BackgroundHandler(shared);
```

Content script:
```js
// Initialize the background script object
let bgScript = new BackgroundScript();

async function foo() {
  // Get a connection to the background script
  let connection = await bgScript.getConnection();

  // Get the variable from the background script
  let variable = await connection.variable;

  console.log(variable);
}

foo();
```

### Execute a method from the background script

Background script:
```js
var variable = null;

function setVariable(val) {
  variable = val;
}

function showVariable() {
  return variable;
}

let shared = {
  setVariable,
  showVariable
}

// Initialize the Background script handler passing the object to be shared
let bgHandler = new BackgroundHandler(shared);
```

Content Script:
```js
let bgScript = new BackgroundScript();

async function foo() {
  let connection = await bgScript.getConnection();

  await connection.setVariable("Hello world");

  let variable = await connection.showVariable();

  console.log(variable);
}

foo();
```

### Shortcut for setting a shared variable

Instead of creating a setter function and using it like I showed in the examples above, if the variable you want to change is shared, you can do it this way:

Background script:
```js

let shared = {
  variable: null
}

let bgHandler = new BackgroundHandler(shared);
```

Content script:
```js
let bgScript = new BackgroundScript();

async function foo() {
  let connection = await bgScript.getConnection();

  // Set the variable. The brackets are there to avoid syntax errors.
  await (connection.variable = "Hello world");

  // Show the new variable value
  console.log(await connection.variable);
}
```

Note that when you set a variable, the new result will be returned (just like when you set a normal variable). This means that doing it this way will give you the same result as before:
```js
  ...
  // Set the variable and log its new value
  console.log(await (connection.variable = "Hello world"));
  ...
```

## Using the sendMessage API alongside this library

Sometimes it could still be useful to have access to the sendMessage API directly. That is, for example, if you need to notify a content script about something that happened in the background script. In that situation, you can use the sendMessage API to send information in this way:

Background script:
```js
chrome.tabs.sendMessage(tabId, "Custom message text", (response) => {
  // Handle the response
});
```

Content script:
```js
let bgScript = new BackgroundScript();

bgScript.onMessage.addListener( (request, sender, sendResponse) => {
  // ...
  sendResponse("Reponse from the content script");
});
```

This is very similar to the original `sendMessage` API, but you won't listen directly to the `chrome.runtime.onMessage` event, instead you will listen to the `bgScript.onMessage` event, which will remove all the messages sent and received from the library for its internal use.

Sending a message from the content script is very similar:

Background script:
```js
let shared = {};

let bgHandler = new BackgroundHandler(shared);

bgHandler.onMessage.addListener( (message, sender, sendResponse) => {
  // Handle the message
});
```

Content script:
```js
chrome.runtime.sendMessage("Custom message from the content script", (response) => {
  // Handle the response
});
```

**Important**: You can send to the background script any kind of messages, but there is one thing to keep in mind: if the message is an object, it **must not** have a `type` property with a value of `"bootstrap"`.