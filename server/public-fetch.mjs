import { lookup } from 'node:dns';
import { Agent } from 'undici';
import ipaddr from 'ipaddr.js';

// Filter the addresses used for the socket connection, including each redirect.
export function publicAddresses(records) {
  return records.filter(({ address }) => {
    if (!ipaddr.isValid(address)) return false;
    const ip = ipaddr.process(address);
    return ip.range() === 'unicast';
  });
}
export const publicDispatcher = new Agent({
  connect: {
    lookup(host, options, callback) {
      lookup(host, { all: true, family: options.family || 0 }, (error, records) => {
        if (error) return callback(error);
        const usable = publicAddresses(records);
        if (!usable.length) return callback(new Error('No public address for place page'));
        if (options.all) return callback(null, usable);
        callback(null, usable[0].address, usable[0].family);
      });
    },
  },
});
