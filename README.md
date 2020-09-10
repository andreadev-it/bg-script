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

Of course, the background script location might be different in your project.