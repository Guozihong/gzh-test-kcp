/**
 * Copyright 2016 leenjewel
 *
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
import { KcpSocket } from './kcpsocket';
import * as pinuscoder from './pinuscoder';
import { IConnector, DictionaryComponent, ProtobufComponent, IComponent } from 'pinus';
import * as coder from '../common/coder';
import { pinus } from 'pinus';

let curId = 1;

export class Connector extends EventEmitter {
    opts: any;
    host: string;
    port: number;
    useDict: boolean;
    useProtobuf: boolean;
    clientsForKcp: { [conv: number]: KcpSocket };
    connector: IConnector;
    dictionary: DictionaryComponent;
    protobuf: ProtobufComponent;
    decodeIO_protobuf: IComponent;
    socket: dgram.Socket;

    constructor(port: number, host: string, opts: any) {
        super();
        this.opts = opts || {};
        this.host = host;
        this.port = port;
        this.useDict = opts.useDict;
        this.useProtobuf = opts.useProtobuf;
        this.clientsForKcp = {};
        this.socket = dgram.createSocket('udp4');
    }

    start(cb: () => void) {
        const app = this.opts.app || pinus.app;
        this.connector = app.components.__connector__.connector;
        this.dictionary = app.components.__dictionary__;
        this.protobuf = app.components.__protobuf__;
        this.decodeIO_protobuf = app.components.__decodeIO__protobuf__;
        this.socket.on('message', (msg, peer) => {
            this.bindSocket(this.socket, peer.address, peer.port, msg);
        });
        this.on('disconnect', (kcpsocket) => {
            const socketUUID = kcpsocket.opts.socketUUID;
            delete this.clientsForKcp[socketUUID];
        });
        this.socket.on('error', (error) => {
            return;
        });

        this.socket.bind(this.port);
        process.nextTick(cb);
    }

    bindSocket(socket: dgram.Socket, address: string, port: number, msg?: any) {
        let conv: number;
        let socketUUID = `${address}:${port}`;
        let kcpsocket = this.clientsForKcp[socketUUID];
        if (!kcpsocket && msg) {
            var kcpHead = pinuscoder.kcpHeadDecode(msg);
            conv = kcpHead.conv;
        }
        if (!kcpsocket && conv) {
            kcpsocket = new KcpSocket(curId++, socket, address, port, Object.assign({}, this.opts, { conv, socketUUID }));
            pinuscoder.setupHandler(this, kcpsocket, this.opts);
            this.clientsForKcp[socketUUID] = kcpsocket;
            this.emit('connection', kcpsocket);
        }
        if (!!msg && !!kcpsocket) {
            kcpsocket.emit('input', msg);
        }
    }

    static decode(msg: Buffer | string) {
        return coder.decode.bind(this)(msg);
    }

    decode(msg: Buffer | string) {
        return Connector.decode(msg);
    }

    static encode(reqid: number, route: string, msg: any) {
        return coder.encode.bind(this)(reqid, route, msg);
    }

    encode(reqid: number, route: string, msg: any) {
        return Connector.encode(reqid, route, msg);
    }

    stop(force: any, cb: () => void) {
        if (this.socket) {
            this.socket.close();
        }
        process.nextTick(cb);
    }
}

