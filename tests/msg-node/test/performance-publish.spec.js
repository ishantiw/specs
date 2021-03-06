/**
* Copyright 2016 PT Inovação e Sistemas SA
* Copyright 2016 INESC-ID
* Copyright 2016 QUOBIS NETWORKS SL
* Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
* Copyright 2016 ORANGE SA
* Copyright 2016 Deutsche Telekom AG
* Copyright 2016 Apizee
* Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

import expect from 'expect.js';
import StubLoader from './StubLoader.js';
import Bus from './Bus.js';
import Util from './Util.js';

describe('messaging object update performance for different number of subscribers', function() {
  this.timeout(10000);

  let stubLoader = new StubLoader();
  let stubConfig = stubLoader.config;
  let util = new Util(stubLoader.stubType);

  let msgNodeAddress = "domain://msg-node." + stubConfig.domain;
  let address;

  let runtimeURLReporter     = "runtime://" + stubConfig.domain + "/Reporter";
  let runtimeStubURLReporter = 'hyperty-runtime://' + stubConfig.domain + '/protostub/Reporter';
  let stubReporter;
  let busReporter;

  let runtimeURLSubscriber     = "runtime://" + stubConfig.domain + "/Subscriber";
  let runtimeStubURLSubscriber = 'hyperty-runtime://' + stubConfig.domain + '/protostub/Subscriber';
  let numEvents = 0;

  // credits for stringFill3 go to: http://www.webreference.com/programming/javascript/jkm3/3.html
  let stringFill3 = (x, n) => {
    var s = '';
    for (;;) {
      if (n & 1) s += x;
      n >>= 1;
      if (n) x += x;
      else break;
    }
    return s;
  }

  let msg100B = stringFill3("x", 100);
  let msg1kB = stringFill3("x", 1024);
  let msg10kB = stringFill3("x", 10240);



  it('prepare: allocate object address', function(done) {

    busReporter = new Bus( (m, num) => {
      switch (num) {
        case 1:
        case 2:
          util.expectStubSuccessSequence(m, runtimeStubURLReporter, num);
          break;
        case 3:
          util.expectStubSuccessSequence(m, runtimeStubURLReporter, num);

          // not using MessageFactory, because it does not support "scheme"
          let msg = {
            // NOTE: According to the spec, id should be a String, but at least Vertx breaks if it really is --> relaxing test
            id: 1,
            type: "create",
            from: runtimeStubURLReporter + "/registry/allocation",
            to: msgNodeAddress + "/address-allocation",
            body: {
              scheme: "connection",
              value : {
                number: 1
              }
            }
          };
          busReporter.sendStubMsg(msg);
          break;

        case 4:
          // this message is expected to be the allocation response
          expect(m.id).to.eql("1");
          expect(m.type.toLowerCase()).to.eql("response");
          expect(m.from).to.eql(msgNodeAddress + "/address-allocation");
          expect(m.to).to.eql(runtimeStubURLReporter + "/registry/allocation");
          expect(m.body.code).to.eql(200);
          expect(m.body.value.allocated.length).to.be(1);
          // remember object address
          address = m.body.value.allocated[0];

          // don't disconnect the Reporter Stub
          done();

        default:
      }
    },
    // enable / disable log of received messages
    false);

    stubReporter = stubLoader.activateStub(runtimeStubURLReporter, busReporter, runtimeURLReporter);
    stubReporter.connect();
  });


  let subscribe = (index) => {
    let msg;
    let bus;
    let stub;

    return new Promise((resolve, reject) => {
      bus = new Bus( (m, num) => {
        switch (num) {
          case 1:
          case 2:
            util.expectStubSuccessSequence(m, runtimeStubURLSubscriber + "/" + index, num);
            break;
          case 3:
          util.expectStubSuccessSequence(m, runtimeStubURLSubscriber + "/" + index, num);

            // NOTE: there is no support for a SubscribeMessageBody in the MessageFactory --> creating msg manually
            msg = {
              // NOTE: According to the spec, id should be a String, but at least Vertx breaks if it really is --> relaxing test
              id: 2,
              type: "subscribe",
              from: runtimeStubURLSubscriber + "/" + index + "/sm",
              to: msgNodeAddress + "/sm",
              body: {
                resources: [address + "/changes", address + "/children/name1"],
                source : runtimeStubURLSubscriber + index
              }
            };
            bus.sendStubMsg(msg);
            break;

          case 4:
            // this message is expected to be the subscription response
            expect(m.id).to.eql("2");
            expect(m.type.toLowerCase()).to.eql("response");
            expect(m.from).to.eql(msgNodeAddress + "/sm");
            expect(m.to).to.eql(runtimeStubURLSubscriber + "/" + index + "/sm");
            expect(m.body.code).to.eql(200);

            resolve(
              {
                bus : bus,
                stub : stub
              }
            );
            break;
          default:
            reject();
        }
      },
      // enable / disable log of received messages
      false);

      stub = stubLoader.activateStub(runtimeStubURLSubscriber + "/" + index, bus, runtimeURLSubscriber + "/" + index);
      stub.connect();
    });
  }


  let checkEvent = (stub, bus, index, payload) => {
    return new Promise((resolve, reject) => {
      bus.setStubMsgHandler((m, num) => {
        switch (num) {
          case 5:
            numEvents+= 1;
            if ((index % 1) == 0 )
              console.log("event: " + index + ", number: " + numEvents + " from: " + m.from);
            expect(m.type.toLowerCase()).to.eql("update");
            expect(m.from).to.eql(address);
            expect(m.to).to.eql(address + "/changes");
            expect(m.body.attribute).to.eql("changedAttribute");
            expect(m.body.value).to.eql(payload);

            stub.disconnect();
            resolve();
            break;
          default:
        }
      },
      false);
    });
  }

  let testNSubscribers = (n, done, payload) => {
    let subscribePromises = [];
    let eventPromises = [];
    let start, end;
    numEvents = 0;

    // subscribe N listeners --> receive promise for each
    for (var i = 0; i < n; i++) {
      // add console output to keep the test alive
      if ( (i % 100) == 0 )
        console.log("subscription: " + i);
      subscribePromises.push( subscribe(i) );
    }

    Promise.all( subscribePromises ).then( (subscribeResults) => {
      console.log("all subscriptions done");

      // install event-checker in each subscriber --> receive promise for each
      for (var i = 0; i < subscribeResults.length; i++) {
        eventPromises.push( checkEvent(subscribeResults[i].stub, subscribeResults[i].bus, i, payload) );
      }

      // test OK, if all eventCheckers resolve
      Promise.all( eventPromises ).then(() => {
        end = Date.now();
        util.log("Duration for " + n + " subscribers and payload-size of " + payload.length, (end - start));

        // disconnecting all stubs now
        let disconnectPromises = [];
        for (var i = 0; i < subscribeResults.length; i++) {
          // disconnectPromises.push( disconnectStub(subscribeResults[i].stub) );
          disconnectPromises.push( new Promise((resolve, reject) => {
              subscribeResults[i].stub.disconnect();
              resolve();
            })
          );
        }
        Promise.all(disconnectPromises).then( () => {
          done();
        });
      });

      // let the Reporter publish an update to the object
      let msg = {
        id: 1,
        type: "update",
        from: address,
        to: address + "/changes",
        body: {
          attribute: "changedAttribute",
          value : payload
        }
      };
      // let msg = MessageFactory.createUpdateMessageRequest(
      //   address,
      //   address + "/changes", // to
      //   payload,  // attribute value
      //   null,
      //   "changedAttribute" // attribute name
      // );

      // send update msg via the Reporters stub
      start = Date.now();
      busReporter.sendStubMsg(msg);
    });
  }

  // ############### 100 iterations
  it('subscribe and publish event with 100 listeners and 100B size', function(done) {
      testNSubscribers(100, done, msg100B);
  });
  it('subscribe and publish event with 100 listeners and 1kB size', function(done) {
      testNSubscribers(100, done, msg1kB);
  });
  it('subscribe and publish event with 100 listeners and 10kB size', function(done) {
      testNSubscribers(100, done, msg10kB);
  });


  // ############### 200 iterations
  it('subscribe and publish event with 200 listeners and 100B size', function(done) {
      testNSubscribers(200, done, msg100B);
  });
  it('subscribe and publish event with 200 listeners and 1kB size', function(done) {
      testNSubscribers(200, done, msg1kB);
  });
  it('subscribe and publish event with 200 listeners and 10kB size', function(done) {
      testNSubscribers(200, done, msg10kB);
  });

  // ############### 1000 iterations
  it('subscribe and publish event with 1000 listeners and 100B size', function(done) {
      testNSubscribers(1000, done, msg100B);
  });
  it('subscribe and publish event with 1000 listeners and 1kB size', function(done) {
      testNSubscribers(1000, done, msg1kB);
  });
  it('subscribe and publish event with 1000 listeners and 10kB size', function(done) {
      testNSubscribers(1000, done, msg10kB);
  });
});
