const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const port = 9000;

const app = express();
const cors = require('cors');
app.use(cors());

const bodyParser = require('body-parser')
app.use(bodyParser.json({limit : '50mb' }));  
app.use(bodyParser.urlencoded({ extended: true }));

// 检查 ssl 证书目录，如果存在证书，那么启动 https 服务，否则启动 http 服务
const sslPath = path.join(__dirname, 'ssl');
const sslKeyPath = path.join(sslPath, 'ssl.key');
const sslCertPath = path.join(sslPath, 'ssl.cert');

const server =  fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath) ?  https.createServer({key: fs.readFileSync(sslKeyPath, 'utf8'), cert: fs.readFileSync(sslCertPath, 'utf8')}, app) : http.createServer(app);

const wss = new WebSocket.Server({ server });
const serverPass = process.env.API_PASSWORD || null;
const timeoutSeconds = parseInt(process.env.API_TIMEOUT) || 30;
let wsConnection;

wss.on('connection', function connection(ws, req) {
  
    // 用正则从 req 的 query （ password=xxx ） 中获得 password
    const password = req.url.match(/password=(.*)/)[1];
    if (serverPass && (password !== serverPass)) {
        ws.close();
        return;
    }
    console.log("api key ok");
    wsConnection=ws;

});

wss.on('error', function error(err) {
    console.log("wss error", err);
});

// 断开
wss.on('close', function close() {
    console.log('disconnected');
    wsConnection = null;
});

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

app.all('/send', isKeyAndExtOk, (req, res) =>{
    
    // 然后将请求的 url，headers,body 通过 WebSocket 发送给客户端
    const url = req.query.url;
    // 去掉 api-key 以后得其他 headers
    let headers = req.headers;
    delete headers['any2api-key'];
    const body = req.body;

    let payload = {
        url: url,
        headers: headers,
        body: body,
        method: req.method
    };

    // 检查下 是否存在 当前域名的 filter 
    const host = new URL(url).host;
    const filterPath = path.join( __dirname, 'filter', host, 'in.js' );
    if( fs.existsSync(filterPath) )
    {
        const filter = require(filterPath);
        if( filter ) payload = filter(payload);
    }

    // 发送数据
    wsConnection.send(JSON.stringify({"any2api":payload}));

    // 设置超时
    const timeout = setTimeout(() => {
        // 如果没有send header
        if( !res.headersSent )
            res.status(408).send('Request Timeout');
    }, 1000 * timeoutSeconds);
    
    // 等待客户端返回数据
    const messageHandler = function incoming(message) {
        console.log("message in", String(message).substring(0,100));
        clearTimeout(timeout);
        // json 解析后返回给客户端
        const ret = JSON.parse(message);
        // console.log("ret", ret);
        if( ret.any2api )
        {
            let payload = {
                headers: ret.headers,
                body: ret.any2api
            }

            // 检查下 是否存在 当前域名的 filter 
            const host = new URL(url).host;
            const filterPath = path.join( __dirname, 'filter', host, 'out.js' );
            if( fs.existsSync(filterPath) )
            {
                const filter = require(filterPath);
                if( filter ) payload = filter(payload);
            }

            if( payload.headers )
            {
                res.header(payload.headers);
                console.log("设置header");
            }
            if( !res.headersSent )
            {
                res.send(payload.body);
                console.log("send body", String(payload.body).substring(0,100));
            }else
            {
                console.log("already send header");
            }
        }

        wsConnection.off('message', messageHandler);
    }

    wsConnection.on('message', messageHandler);

});



const streamProcess =  (req, res) =>{
    // 当前被访问的path
    const url =  req.params.domain ? `https:/${req.path}` : req.query.url;
    if( !url ) return res.status(400).send('url is required');

    console.log("url",url);
    let headers = req.headers;
    delete headers['any2api-key'];
    const body = req.body;

    let payload = {
        url: url,
        headers: headers,
        body: body,
        method: req.method
    };

    // 流模式下，inFilter是一样的
    const host = new URL(url).host;
    const filterPath = path.join( __dirname, 'filter', host, 'in.js' );
    if( fs.existsSync(filterPath) )
    {
        const filter = require(filterPath);
        if( filter ) payload = filter(payload);
    }
    console.log("send payload", payload);
    // 发送数据
    wsConnection.send(JSON.stringify({"any2stream":payload}));

    // 设置超时
    const timeout = setTimeout(() => {
        // 如果没有send header
        if( !res.headersSent )
            res.status(408).send('Request Timeout');
    }, 1000 * timeoutSeconds);
    
    // 等待客户端返回数据
    const messageHandler = function incoming(message) {
        // console.log("message in", String(message).substring(0,100));
        clearTimeout(timeout);
        // json 解析后返回给客户端
        const ret = JSON.parse(message);
        // console.log("ret", ret);
        if( ret.any2stream )
        {
            if( ret.type == 'header' )
            {
                // res.header(ret.any2stream);
                // res.writeHead(200, {...ret.any2stream, ...{
                //     'Content-Type': 'text/event-stream;charset=utf-8',
                //     'Cache-Control': 'no-cache',
                //     'Connection': 'keep-alive'
                // }});
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream;charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
          
                console.log("header", ret.any2stream);
            }

            if( ret.type == 'error' )
            {
                res.status(400).send(ret.any2stream);
                wsConnection.off('message', messageHandler);
            }

            if( ret.type == 'chunk' )
            {
                const chunk = ret.any2stream;
                if( chunk == "[DONE]" )
                {
                    res.write(`data: [DONE]\n\n`);
                    res.end();
                    wsConnection.off('message', messageHandler);
                    return;
                }
                let chunkInfo = JSON.parse(chunk);

                // 检查下 是否存在 当前域名的 filter 
                const host = new URL(url).host;
                const filterPath = path.join( __dirname, 'filter', host, 'chunk.js' );
                if( fs.existsSync(filterPath) )
                {
                    const filter = require(filterPath);
                    if( filter ) chunkInfo = filter(chunkInfo);
                }

                res.write(`data: ${JSON.stringify(chunkInfo)}\n\n`);
                console.log("chunk", `data: ${JSON.stringify(chunkInfo)}\n\n`);
                if( chunkInfo.finish_reason || chunkInfo.stop_reason )
                {
                    res.end();
                    wsConnection.off('message', messageHandler);
                    return ;
                }
            }
        }
    }

    wsConnection.on('message', messageHandler);

}

app.all('/stream',isKeyAndExtOk,streamProcess);
app.all('/:domain/v1/chat/completions',isKeyAndExtOk,streamProcess);

  // 启动服务器
server.listen(port, () => {
    console.log(`Server started on port ${port}`);
});

function isKeyAndExtOk( req, res, next )
{
    // 首先从 req 的 header 中获得 password
    const password = req.headers['any2api-key'];
    if (serverPass && (password !== serverPass)) {
        res.status(401).send('Unauthorized');
        return;
    }

    if( !wsConnection )
    {
        res.status(500).send('Extension not ready');
        return;
    }

    next();
}

