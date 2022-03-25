/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import * as kcp from 'node-kcp-x';
import * as pinuscoder from './connectors/pinuscoder';
import * as coder from './common/coder';

interface IOpts {
    host: string;
    port: number; 
    conv?: number;
    nodelay?: number;
    interval?: number;
    resend?: number;
    nc?: number;
    sndwnd?: number;
    rcvwnd?: number;
    mtu?: number;
    usePinusPackage?: boolean;
    userData?: any;
}

export class PinusClient extends EventEmitter {
    private opts: IOpts;
    private host: string;
    private port: number;
    private heartbeatId: NodeJS.Timeout;
    private kcpobj: kcp.KCP;
    private socket: dgram.Socket;
    private reqId: number;
    private cbMap: { [k: number]: Function };
    private connectedCb: Function;

    constructor(opts: IOpts, cb?: Function) {
        super();
        this.connectedCb = cb;
        this.setHostAndPort(opts.host, opts.port);
        var self = this;
        this.opts = opts;
        this.reqId = 0;
        this.cbMap = {};
        this.heartbeatId = undefined;
        var conv = opts.conv || 123;
        this.kcpobj = new kcp.KCP(conv, self);
        var nodelay = opts.nodelay || 0;
        var interval = opts.interval || 40;
        var resend = opts.resend || 0;
        var nc = opts.nc || 0;
        this.kcpobj.nodelay(nodelay, interval, resend, nc);

        var sndwnd = opts.sndwnd || 32;
        var rcvwnd = opts.rcvwnd || 32;
        this.kcpobj.wndsize(sndwnd, rcvwnd);

        var mtu = opts.mtu || 1400;
        this.kcpobj.setmtu(mtu);

        this.socket = dgram.createSocket('udp4');
        this.socket.on('error', function (error: Error) {
            console.log(`client error:\n${error.stack}`);
            self.socket.close();
        });
        this.socket.on('message', function (msg, peer) {
            self.kcpobj.input(msg);
            var data = self.kcpobj.recv();
            if (!data) {
                return;
            }
            if (self.opts?.usePinusPackage) {
                var pkg = pinuscoder.coders.decodePackage(data);
                if (Array.isArray(pkg)) {
                    for (let i in pkg) {
                        self.processPackage(pkg[i]);
                    }
                } else {
                    self.processPackage(pkg);
                }
            } else {
                self.emit('data', JSON.parse(data.toString()));
            }
        });

        this.kcpobj.output((data, size, context) => {
            self.socket.send(data, 0, size, context.port, context.host);
        });

        this.on('connected', function (pkg) {
            console.log('connected ...');
            self.connectedCb && self.connectedCb(pkg);
            self.connectedCb = undefined;
        });

        this.on('handshake', function (pkg) {
            console.log('handshake ...');
            self.ack();
            self.init(pkg);
        });

        this.on('heartbeat', function (pkg) {
            console.log('heartbeat...' + pinuscoder.getHeartbeatInterval());
            if (!self.heartbeatId) {
                self.emit('connected', pkg);
            }
            self.heartbeatId = setTimeout(function () {
                self.heartbeat();
            }, pinuscoder.getHeartbeatInterval());
        });

        this.on('kick', function (pkg) {
            console.log('kick ...');
            self.socket.close();
        });

        this.check();

        if (!opts.usePinusPackage) {
            setTimeout(function () {
                self.emit('connected');
            }, 0);
        }

        this.handshake();
    }

    private processPackage(pkg: any) {
        if (pinuscoder.isHandshakePackage(pkg.type)) {
            this.emit('handshake', JSON.parse(pkg.body));
        } else if (pinuscoder.isHeartbeatPackage(pkg.type)) {
            this.emit('heartbeat', pkg);
        } else if (pinuscoder.isDataPackage(pkg.type)) {
            pkg = coder.decode(pkg);
            this.processMessage(pkg);
        } else if (pinuscoder.isKickPackage(pkg.type)) {
            this.emit('kick', pkg);
        } else {
            this.emit('message', pkg.body);
        }
    }

    private processMessage ({ id, route, body }: {
        id: number;
        route: string;
        body: any;
    }) {
        this.emit('data', body);
        if (!id) {
          this.emit(route, body);
          return
        }
        //if have a id then find the callback function with the request
        let cb = this.cbMap[id]
        delete this.cbMap[id]
        if (typeof cb === 'function') {
            cb(body)
        }
    }

    setHostAndPort(host: string, port: number) {
        this.host = host;
        this.port = port;

        if (!host || !port) {
            throw new Error("host and port must point!");
        }
    }

    private check () {
        var self = this;
        this.kcpobj.update(Date.now());
        setTimeout(function () {
            self.check();
        }, this.kcpobj.check(Date.now()));
    };

    private send (data: any) {
        this.kcpobj.send(data);
        this.kcpobj.flush();
    };

    request (route: string, msg: any, cb?: Function) {
        if (this.opts?.usePinusPackage) {
            this.reqId ++;
            cb && (this.cbMap[this.reqId] = cb);
            msg = pinuscoder.messagePackage(this.reqId, route, msg);
            this.send(msg);
        } else {
            this.send(JSON.stringify(msg));
        }
    };

    notify (route: string, msg: any) {
        if (this.opts?.usePinusPackage) {
            msg = pinuscoder.messagePackage( 0, route, msg );
            this.send(msg);
        } else {
            this.send(JSON.stringify(msg));
        }
    };

    private handshake () {
        if (this.opts?.usePinusPackage) {
            this.send(pinuscoder.handshakePackage(this.opts.userData));
        }
    };

    private init (data: any) {
        if (this.opts?.usePinusPackage) {
            pinuscoder.initProtocol(data);
        }
    };

    private ack () {
        if (this.opts?.usePinusPackage) {
            this.send(pinuscoder.handshakeAckPackage());
        }
    };

    private heartbeat () {
        if (this.opts?.usePinusPackage) {
            this.send(pinuscoder.heartbeatPackage());
        }
    };

    disconnect () {
        this.socket.disconnect();
        this.kcpobj = null;
    }
}
//  // Run Test
//  var reqid = 1;
//  var client = new PinusClient('127.0.0.1', 3010, {usePinusPackage: true});
//  client.handshake();
//  client.on('connected', function(userdata){
//      console.log('onConnected and send request...');
//      client.request({
//          id: reqid++,
//          route: 'connector.entryHandler.entry',
//          body: {}
//      });
//  });
//  client.on('data', function(userdata){
//      setTimeout(function() {
//          console.log('onData : '+JSON.stringify(userdata)+' and send request : '+(reqid+1));
//      client.request({
//          id: reqid++,
//          route: 'connector.entryHandler.entry',
//          body: {}
//      });
//      }, 500);
//  });