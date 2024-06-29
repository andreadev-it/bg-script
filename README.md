# bg-script - Library for chrome extension communication
![npm (scoped)](https://img.shields.io/npm/v/@andreadev/bg-script)
![chrome: 55+](https://img.shields.io/badge/chrome%20version-55%2B-orange)

This library will help you communicate between your content scripts and the background script, offering an alternative to the default `sendMessage` API.
The chrome API that do this is not very practical in the way it's layed out, and doesn't allow you to easily get response for asynchronous
actions.

This project was inspired by [comlink](https://github.com/GoogleChromeLabs/comlink), and it started out as a way for me to better understand Javascript Proxies.

## How does it work?

### Access background script methods from content script

In your background script, you must create a BackgroundHandler class and pass it an object that contains the properties and methods you want to share:

```js
// background.js

function remoteFunction() {
  return "Executed remotely";
}

let bgHandler = new BackgroundHandler({
  remoteFunction // This is a shorthand for `remoteFunction: remoteFunction`
});
```

In your content script, you should create a BackgroundScript class and then use it like this:

```js
var bgScript = new BackgroundScript("script-id");

// Use an async function for better code!
async function foo() {
   // Get a reference to the background script connection (which is a proxy)
   let connection = await bgScript.getConnection();
   
   let result = await connection.remoteFunction();

   console.log(result); // --> "Executed remotely"
}

// Execute the function when needed
foo();
```

### Acess content scripts methods from the background script

You can call methods exposed from the content script in a similar way:

```js
// Content Script file

function contentScriptMethod() {
  return "Executed in the content script";
}

var bgScript = new BackgroundScript("my-script" , {
  contentScriptMethod
});
```

If you have the tabId where the script resides, you can call its methods like this:
```js
// Background script file

var bgHandler = new BackgroundHandler();

async function callScriptMethod(tabId) {
  let connection = await bgHandler.getScriptConnection("my-script", tabId);

  let result = await connection.contentScriptMethod();

  console.log(result); // --> Executed in the content script;
}

```

## Installation

### Without bundler

Download the `build/bgscript.js` file and include it in your chrome extension in the following two ways.

In order to use it in your content scripts, include it in your manifest.json as the first content script:

```
"content_scripts": [{
  "js": ["bgscript.js", "my-content-script.js", ...]
}]
```

Similarly, for the background, you need to declare it as first script in the "background scripts" section of your manifest file:

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

### With bundler

If you use a bundler, you can install the npm package:
```
npm install --save @andreadev/bg-script
```

Then, in your code, you can just import the class that you want to use:
```js
// Background script
import { BackgroundHandler } from '@andreadev/bg-script';

// Content script
import { BackgroundScript } from '@andreadev/bg-script';
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

foo();
```

Note that when you set a variable, the new value will be returned (just like when you set a normal variable). This means that doing it this way will give you the same result as before:
```js
  ...
  // Set the variable and log its new value
  console.log(await (connection.variable = "Hello world"));
  ...
```

## Communicate with the content scripts
From version 1.1.0, you can do all the aforementioned actions from the background script too!

By default, the scripts are associated with their tab ids. For this reason, you should first know which tab you want to communicate with (you can also request the tabs where a specific script is active, as shown later). If you have this tab id in a variable called "tabId", then you can do the following:

```js
// Background script
var bgHandler = new BackgroundHandler();

// ...

async function callContentScript(tabId) {
  let connection = await bgHandler.getScriptConnection("script-id", tabId);
  await connection.remoteMethod(); // This method resides in the content script.
}
```

The first variable for the `getScriptConnection` method is the script ID. This must be set in the content script when a new `BackgroundScript` class is created:

```js
// Content script

var bgScript = new BackgroundScript("script-id", {
  remoteMethod
});

function remoteMethod() {
  return "Method in the content script";
}
```

You can also use a method on the BackgroundHandler to request the various tab Ids where a script is connected. This is the way to do it:
```js
async function broadcast() {
  let tabIds = await bgHandler.getScriptTabs("script-id-here");
  for (let id of tabIds) {
    // get the connection and call a method
  } 
} 
```

## API Reference

### BackgroundHandler class

Class creation:
```js
var bgHandler = new BackgroundHandler( [exposed-data], [options] );
```

Parameters:
| Parameter | Description |
| --------- | ----------- |
| [exposed-data] | **Object** (optional) - An object containing all the properties and methods that will be exposed to the content scripts. This are the limitations: do not put a property (or method) called "then" or "$getMyTabId", because they will be rejected. Also, if you expose a property, it must be JSON-friendly to be correctly received by other scripts. All exposed methods should also return JSON-friendly values in order to work correctly. | 
| [options] | **Object** (optional) - An object that will enable further customization.
| [options.errorCallback] | **function** - A callback that will be fired whenever there is an error in the background handler. It will get passed an object with some details of the error: an `errorId` and an `error` (the error description).| 

Events:

| Name | Details | Description |
| ---- | ------- | ----------- |
| connectionreceived | `{ scriptId, tabId }` | This event fires when a script has successfully connected to the background handler. |
| connectionended | `{ scriptId, tabId }` | This event fires when a script has succesfully disconnected from the background handler. |

In [this page](https://developer.chrome.com/docs/extensions/mv2/messaging/#port-lifetime) you can find more information about the connection lifecycle.

### BackgroundScript class

**Class creation:**
```js
var bgScript = new BackgroundScript( [script-id], [exposed-data], [options] );
```

Parameters:

| Parameter | Description |
| --------- | ----------- |
| [script-id] | **String** (optional) - A unique ID for this script. By default, this id will be tab-specific, so that you can have multiple tabs with the same script using the same script id. If omitted, a unique id will be generated |
| [exposed-data] | **Object** (optional) - An object containing all the properties and methods that will be exposed to the Background script. You can put almost everything here, but just avoid to insert a "then" method, because it will be ignored. Also remember that if you want to directly get a remote property, it must be JSON-friendly, so don't insert properties that cannot be converted to JSON. |
| [options] | **Object** (optional) - An object with some options to customize how the script work |
| [options.context] | **String** - One of "content" (default), "devtools" and "tab-agnostic". If the value is "content", the script id will be associated with the current tab id. If you want to use this library from a devtools script, then you must set this option to "devtools" to automatically associate the script id with the inspected tab id. If the value is "tab-agnostic" the script id won't be associated to any tab id, so you won't be able to create another connection with the same script id. |

Events:

| Name | Description |
| ---- | ----------- |
| connected | The script has succesfully connected to the background handler. Since the first connection is done when you create the class instance, this event will only fire for the following connections and not for the first one.
| disconnected | The script has succesfully disconnected from the background handler. |

### Connection proxy

Get a connection to the background script:
```js
// Content script
let bgScript = new BackgroundScript("script-id");
//...
let connection = await bgScript.getConnection();
```

Get a connection to a content script:
```js
// Background script
let bgHandler = new BackgroundHandler();
// ...
let connection = await bgHandler.getScriptConnection("script-id", tabId);
```

Also, if you're in a content script, you can retrieve your tabId by calling this method:
```js
let connection = await bgScript.getConnection();

let tabId = await connection.$getMyTabId();
```

## Using the sendMessage API alongside this library

From version 1.2.0, there is a very small limitation on how to use the "sendMessage" API, even though this library mostly uses ports. Just avoid having a message that is an object, with a `type` property that starts with "bgscript".
