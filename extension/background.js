let isConnected = false;
let reconnectSeconds = 5;
let reconnectTimeoutHandler = null;
let socket = null;
chrome.runtime.onInstalled.addListener(function() {
    chrome.storage.sync.set({
      enabled: false
    }, function() {
      console.log('Plugin disabled by default');
    });
  });
  
  chrome.runtime.onStartup.addListener(function() {
    chrome.storage.sync.get(['enabled'], function(result) {
      if (result.enabled) {
        startWebSocket();
      }
    });
  });
  
  chrome.storage.onChanged.addListener(function(changes) {
    if (changes.enabled) {
      if (changes.enabled.newValue) {
        startWebSocket();
      } else {
        stopWebSocket();
      }
    }
  });
  
  async function startWebSocket() {
    if( isConnected )
    {
      console.log("connected");
      return false;
    }

    
    chrome.storage.sync.get(['url', 'port', 'password'], function(result) {
      const urlInfo = new URL(result.url);
      const port = result.port;
      const password = result.password;
      const wsProtocol = urlInfo.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${wsProtocol}://${urlInfo.host}:${port}?password=${password}`);
      
      socket.onopen = function() {
        console.log('WebSocket connection established');
        // 设置 isConnected 为 true 表示成功连接
        isConnected = true;
        // 更新插件图标
        updatePluginBadge();
        reconnectSeconds = 5;
        clearTimeout(reconnectTimeoutHandler);
      };

      socket.onerror = function(error) {
        console.log('WebSocket connection error', error);
        reconnect();
      }

      socket.onclose = function() {
        console.log('WebSocket connection closed');
        reconnect();
      }


      

      socket.onmessage = function(event) {
        const { any2api, any2stream} = JSON.parse(event.data);
        if( any2api )
        {
            const { url, headers, body, method } = any2api;
            
            chrome.cookies.getAll({ url: url }, async function(cookies) {
            
            console.log("cookies", cookies);
            const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

            const payload = {
                method,
                headers: {
                ...headers,
                'cookie': cookieHeader,
                'host': new URL(url).host,
                }
            };
            if( body && !['GET','HEAD'].includes(String(method).toUpperCase()) ) 
              payload.body = body;
            else
              delete payload.body;

            console.log("payload", payload);

            const ret = await fetch(url, payload);
            const responseHeaders = {};
            for (const [name, value] of ret.headers.entries()) {
                responseHeaders[name] = value;
              }
            const responseText = await ret.text();
            // console.log("responseText", responseText.substring(0,100));
            if( responseText )
            {
                console.log("send-message");
                socket.send(JSON.stringify({"any2api":responseText,"headers":responseHeaders}));
            }

            });

        }

        if( any2stream )
        {
            const { url, headers, body, method } = any2stream;
            
            chrome.cookies.getAll({ url: url }, async function(cookies) {
            const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

            const payload = {
                method,
                headers: {
                ...headers,
                'cookie': cookieHeader,
                'host': new URL(url).host,
                }
            };
            
            if( body ) payload.body = JSON.stringify(body);
            console.log("payload", payload);

            const ret = await fetch(url, payload);
            const responseHeaders = {};
            for (const [name, value] of ret.headers.entries()) {
                responseHeaders[name] = value;
            }
            
            if( ret.ok )
            {
              console.log( "ret.ok", "send header" );
              // 先把 header 发送出去
              socket.send(JSON.stringify({"any2stream":responseHeaders,"type":"header"}));
            }else
            {
              // 发送 error 
              const error = await ret.text();
              console.log( "ret.error", error );
              socket.send(JSON.stringify({"any2stream":{error,"header":responseHeaders},"type":"error"}));
            }

            // 然后可以发送chunk了，先把解析器写了
            const parser = createParser((event) => {
              // console.log(event);    
              if (event.type === "event") {
                socket.send(JSON.stringify({"any2stream":event.data,"type":"chunk"}));
              }
            });

            if( !ret.body.getReader )
            {
              // 如果不支持 getReader，那么就直接读取
              const body = ret.body;
              if (!body.on || !body.read) {
                throw new error('unsupported "fetch" implementation');
              }
              body.on("readable", () => {
                let chunk;
                while (null !== (chunk = body.read())) {
                  // console.log(chunk.toString());
                  parser.feed(chunk.toString());
                }
              });
            }else
            {
              for await (const chunk of streamAsyncIterable(ret.body)) {
                const str = new TextDecoder().decode(chunk);
                parser.feed(str);
              }
            }


            });

        }
        
      };
    });
  }

  function reconnect()
  {
    isConnected = false;
    // 更新插件图标
    updatePluginBadge();

    // 如果插件 enabled，尝试重连
    if (chrome.storage.sync.get(['enabled'])) {
      reconnectTimeoutHandler = setTimeout(startWebSocket, reconnectSeconds * 1000);
      reconnectSeconds = Math.min(reconnectSeconds * 2, 60*24);
    }
  }

  function updatePluginBadge()
  {
    // 使用 Mv3 规范
    chrome.action.setBadgeText({text: isConnected ? 'ON' : 'OFF'});
    // set text color to white
    chrome.action.setBadgeTextColor({color: '#ffffff'});
    chrome.action.setBadgeBackgroundColor({color: isConnected ? '#4688F1' : '#333333'});
  }
  
  function stopWebSocket() {
    // Close WebSocket connection 
    if( socket ) socket.close();
    // 设置 isConnected 为 false 表示断开连接
    isConnected = false;
    // 更新插件图标
    updatePluginBadge();
  }

  async function myFetch(url, options) {
    const {timeout, ...fetchOptions} = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout||30000)
    const res = await fetch(url, {...fetchOptions,signal:controller.signal});
    clearTimeout(timeoutId);
    return res;
}

async function* streamAsyncIterable(stream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

// ============
// based on https://github.com/rexxars/eventsource-parser/blob/main/src/parse.ts
// ============
function createParser(onParse) {
    let isFirstChunk;
    let buffer;
    let startingPosition;
    let startingFieldLength;
    let eventId;
    let eventName;
    let data;
    reset();
    return {
      feed,
      reset
    };
    function reset() {
      isFirstChunk = true;
      buffer = "";
      startingPosition = 0;
      startingFieldLength = -1;
      eventId = void 0;
      eventName = void 0;
      data = "";
    }
    function feed(chunk) {
      buffer = buffer ? buffer + chunk : chunk;
      if (isFirstChunk && hasBom(buffer)) {
        buffer = buffer.slice(BOM.length);
      }
      isFirstChunk = false;
      const length = buffer.length;
      let position = 0;
      let discardTrailingNewline = false;
      while (position < length) {
        if (discardTrailingNewline) {
          if (buffer[position] === "\n") {
            ++position;
          }
          discardTrailingNewline = false;
        }
        let lineLength = -1;
        let fieldLength = startingFieldLength;
        let character;
        for (let index = startingPosition; lineLength < 0 && index < length; ++index) {
          character = buffer[index];
          if (character === ":" && fieldLength < 0) {
            fieldLength = index - position;
          } else if (character === "\r") {
            discardTrailingNewline = true;
            lineLength = index - position;
          } else if (character === "\n") {
            lineLength = index - position;
          }
        }
        if (lineLength < 0) {
          startingPosition = length - position;
          startingFieldLength = fieldLength;
          break;
        } else {
          startingPosition = 0;
          startingFieldLength = -1;
        }
        parseEventStreamLine(buffer, position, fieldLength, lineLength);
        position += lineLength + 1;
      }
      if (position === length) {
        buffer = "";
      } else if (position > 0) {
        buffer = buffer.slice(position);
      }
    }
    function parseEventStreamLine(lineBuffer, index, fieldLength, lineLength) {
      if (lineLength === 0) {
        if (data.length > 0) {
          onParse({
            type: "event",
            id: eventId,
            event: eventName || void 0,
            data: data.slice(0, -1)
            // remove trailing newline
          });
  
          data = "";
          eventId = void 0;
        }
        eventName = void 0;
        return;
      }
      const noValue = fieldLength < 0;
      const field = lineBuffer.slice(index, index + (noValue ? lineLength : fieldLength));
      let step = 0;
      if (noValue) {
        step = lineLength;
      } else if (lineBuffer[index + fieldLength + 1] === " ") {
        step = fieldLength + 2;
      } else {
        step = fieldLength + 1;
      }
      const position = index + step;
      const valueLength = lineLength - step;
      const value = lineBuffer.slice(position, position + valueLength).toString();
      if (field === "data") {
        data += value ? "".concat(value, "\n") : "\n";
      } else if (field === "event") {
        eventName = value;
      } else if (field === "id" && !value.includes("\0")) {
        eventId = value;
      } else if (field === "retry") {
        const retry = parseInt(value, 10);
        if (!Number.isNaN(retry)) {
          onParse({
            type: "reconnect-interval",
            value: retry
          });
        }
      }
    }
  }
  const BOM = [239, 187, 191];
  function hasBom(buffer) {
    return BOM.every((charCode, index) => buffer.charCodeAt(index) === charCode);
  }
