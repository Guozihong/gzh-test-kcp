gzh-test-kcp
============

[![Build Status][1]][2]

[1]: https://api.travis-ci.org/leenjewel/node-kcp.svg?branch=master
[2]: https://travis-ci.org/leenjewel/node-kcp


[KCP Protocol](https://github.com/skywind3000/kcp) for [Pinus](https://github.com/node-pinus/pinus)

说明
============

[Pinus](https://github.com/node-pinus/pinus) 的 kcp connector

====

对 [pinus-kcp](https://github.com/bruce48x/pinus-kcp)进行了依赖升级，新增了kcp-client用于测试connector是否配置成功

## 安装

`yarn add pinus-kcp`

## 使用

```typescript
import * as kcpconnector from 'pinus-kcp';

app.configure('production|development', 'connector', function () {
    app.set('connectorConfig', {
        connector: kcpconnector.Connector,
        app: pinus.app,
        heartbeat: 30,
        // kcp options
        sndwnd: 64,
        rcvwnd: 64,
        nodelay: 1,
        interval: 10,
        resend: 2,
        nc: 1,
        // 1.0 新增参数
        // 每次处理 package 时都刷新心跳，避免收不到心跳包的情况下掉线的问题
        // 这个值默认是 false
        heartbeatOnData: true,  
    });
});

// start app
app.start(() => {
    let client = new kcpconnector.PinusClient({
        host: '127.0.0.1',
        port 3010, 
        usePinusPackage: true
    });
    client.on('connected', function(userdata){
        console.log('onConnected and send request...');
        let param = { userId: 101, channelId: 1001 };
        client.request('connector.entryHandler.entry', { param }, (res: any) => {
            console.log('onRequest : ' + JSON.stringify(res));
        });
    });
    client.on('data', function(res){
        console.log('onData : ' + JSON.stringify(res));
        setTimeout(function() {
            client.request('connector.entryHandler.entry', {
                param: {
                    userId: 101,
                    channelId: 1001
                }
            }, (res: any) => {
                console.log('onRequest : ' + JSON.stringify(res));
            });
        }, 500);
    });
});
```
