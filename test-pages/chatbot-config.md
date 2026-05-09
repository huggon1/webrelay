# Chatbot Test Configuration

Open `test-pages/chatbot.html` in Chrome. If you load it through `file://`, enable "Allow access to file URLs" for the unpacked WebRelay extension in `chrome://extensions`.

Create a new profile with:

- Name: `Chat to Markdown`
- URL pattern: `file:///*` for local file testing, or use the generated pattern if serving the page over HTTP.
- Action: `Copy` for the first test, then try `Download` and `Copy + Download`.

Recipe JSON:

```json
{
  "version": 1,
  "mode": "list",
  "rootSelector": ".chat-message",
  "fields": [
    {
      "name": "role",
      "value": "attribute",
      "attribute": "data-role",
      "required": true
    },
    {
      "name": "time",
      "selector": ".message-time",
      "value": "textContent",
      "required": true
    },
    {
      "name": "text",
      "selector": ".message-text",
      "value": "textContent",
      "required": true
    }
  ]
}
```

JS transform body:

```js
const messages = JSON.parse(input);
return messages
  .map((m) => `### ${m.role} (${m.time})\n\n${m.text}`)
  .join("\n\n---\n\n");
```

Expected output is a Markdown transcript with one section per message.
