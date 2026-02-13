// // config/redis.js
// config/redis.js
import { Redis } from '@upstash/redis';

let redisClient;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const upstashClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Wrap Upstash client to add missing methods
  redisClient = {
    exists: (key) => upstashClient.get(key).then(val => (val !== null ? 1 : 0)),
    set: (key, value, options) => upstashClient.set(key, value, options),
    get: (key) => upstashClient.get(key),
    del: (key) => upstashClient.del(key),
    setEx: (key, ttl, value) => upstashClient.set(key, value, { ex: ttl }),
    setex: (key, ttl, value) => upstashClient.set(key, value, { ex: ttl }),
    expire: (key, ttl) => upstashClient.expire(key, ttl),
    incr: (key) => upstashClient.incrby(key, 1),
    incrby: (key, delta) => upstashClient.incrby(key, delta),
    hincrby: (key, field, increment) => upstashClient.hincrby(key, field, increment),
    hgetall: (key) => upstashClient.hgetall(key),
    lpush: (key, ...values) => upstashClient.lpush(key, values),
    lrange: (key, start, end) => upstashClient.lrange(key, start, end),
    ping: () => upstashClient.ping(),
    keys: (pattern) => {
      // Upstash Redis doesn't support KEYS command via REST API
      // Return empty array for health checks and monitoring
      console.warn(`Redis KEYS command not supported by Upstash Redis. Pattern: ${pattern}`);
      return Promise.resolve([]);
    },
  };

  console.log('Connected to Upstash Redis via REST');
} else {
  // Mock Redis for local dev / testing
  const store = new Map();
  if (typeof global !== 'undefined') global.redisStore = store;

  redisClient = {
    connect: () => Promise.resolve(),
    set: (key, value) => { store.set(key, value); return Promise.resolve('OK'); },
    get: (key) => Promise.resolve(store.get(key) || null),
    setEx: (key, ttl, value) => { store.set(key, value); return Promise.resolve('OK'); },
    setex: (key, ttl, value) => { store.set(key, value); return Promise.resolve('OK'); },
    expire: (key, ttl) => Promise.resolve(1),
    incr: (key) => {
      const current = parseInt(store.get(key) || '0');
      store.set(key, (current + 1).toString());
      return Promise.resolve(current + 1);
    },
    incrby: (key, delta) => {
      const current = parseInt(store.get(key) || '0');
      const newValue = current + delta;
      store.set(key, newValue.toString());
      return Promise.resolve(newValue);
    },
    hincrby: (key, field, increment) => {
      const hashKey = `${key}:${field}`;
      const current = parseInt(store.get(hashKey) || '0');
      store.set(hashKey, (current + increment).toString());
      return Promise.resolve(current + increment);
    },
    hgetall: (key) => {
      const result = {};
      for (const [storeKey, value] of store.entries()) {
        if (storeKey.startsWith(`${key}:`)) {
          const field = storeKey.split(':')[1];
          result[field] = value;
        }
      }
      return Promise.resolve(result);
    },
    lpush: (key, ...values) => {
      const listKey = `list:${key}`;
      let list = store.get(listKey) || [];
      list.unshift(...values);
      store.set(listKey, list);
      return Promise.resolve(list.length);
    },
    lrange: (key, start, end) => {
      const listKey = `list:${key}`;
      const list = store.get(listKey) || [];
      const result = list.slice(start, end === -1 ? undefined : end + 1);
      return Promise.resolve(result);
    },
    del: (key) => { store.delete(key); return Promise.resolve(1); },
    exists: (key) => Promise.resolve(store.has(key) ? 1 : 0),
    ping: () => Promise.resolve('PONG'),
    keys: (pattern) => {
      const keys = Array.from(store.keys()).filter(key => {
        // Simple pattern matching for * wildcard
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(key);
      });
      return Promise.resolve(keys);
    },
  };

  console.log('Using mock Redis');
}

export default redisClient;

// import { createClient } from 'redis';

// let redisClient;

// if (process.env.REDIS_URL && process.env.REDIS_URL !== 'redis://your_upstash_redis_url_here') {
//   redisClient = createClient({
//     url: process.env.REDIS_URL
//   });
//   redisClient.on('error', (err) => console.error('Redis Client Error', err));
//   // Connect lazily to avoid top-level await
//   redisClient.connect().catch(err => console.error('Redis connection failed:', err));
// } else {
//   // Mock Redis for MVP and testing
//   const store = new Map();

//   // Make store globally accessible for test cleanup
//   if (typeof global !== 'undefined') {
//     global.redisStore = store;
//   }

//   redisClient = {
//     connect: () => Promise.resolve(),
//     set: (key, value, ...args) => {
//       store.set(key, value);
//       return Promise.resolve('OK');
//     },
//     get: (key) => {
//       return Promise.resolve(store.get(key) || null);
//     },
//     setEx: (key, ttl, value) => {
//       store.set(key, value);
//       return Promise.resolve('OK');
//     },
//     exists: (key) => {
//       return Promise.resolve(store.has(key) ? 1 : 0);
//     },
//     incr: (key) => {
//       const current = store.get(key) || 0;
//       const newValue = parseInt(current) + 1;
//       store.set(key, newValue.toString());
//       return Promise.resolve(newValue);
//     },
//     del: (key) => {
//       store.delete(key);
//       return Promise.resolve(1);
//     },
//     expire: () => Promise.resolve(1),
//     lpush: (key, value) => {
//       const current = store.get(key);
//       let list = [];
//       if (current) {
//         try {
//           list = JSON.parse(current);
//           if (!Array.isArray(list)) {
//             list = [current]; // If it's not an array, treat it as a single item
//           }
//         } catch (e) {
//           list = [current]; // If it's not JSON, treat it as a single item
//         }
//       }
//       list.unshift(value);
//       store.set(key, JSON.stringify(list));
//       return Promise.resolve(list.length);
//     },
//     setex: (key, ttl, value) => {
//       store.set(key, value);
//       // Mock TTL - in real Redis this would expire after ttl seconds
//       return Promise.resolve('OK');
//     },
//     ltrim: (key, start, end) => {
//       const current = store.get(key);
//       if (!current) return Promise.resolve(0);
      
//       let list = [];
//       try {
//         list = JSON.parse(current);
//         if (!Array.isArray(list)) {
//           list = [current];
//         }
//       } catch (e) {
//         list = [current];
//       }
      
//       const trimmed = list.slice(start, end + 1);
//       store.set(key, JSON.stringify(trimmed));
//       return Promise.resolve(trimmed.length);
//     },
//     lrange: (key, start, end) => {
//       const current = store.get(key);
//       if (!current) return Promise.resolve([]);
      
//       let list = [];
//       try {
//         list = JSON.parse(current);
//         if (!Array.isArray(list)) {
//           list = [current];
//         }
//       } catch (e) {
//         list = [current];
//       }
      
//       const result = list.slice(start, end === -1 ? undefined : end + 1);
//       return Promise.resolve(result);
//     },
//     hgetall: (key) => {
//       const current = store.get(key);
//       if (!current) return Promise.resolve({});
      
//       try {
//         const hash = JSON.parse(current);
//         return Promise.resolve(hash);
//       } catch (e) {
//         return Promise.resolve({});
//       }
//     },
//     hincrby: (key, field, increment) => {
//       const current = store.get(key);
//       let hash = {};
//       if (current) {
//         try {
//           hash = JSON.parse(current);
//         } catch (e) {
//           hash = {};
//         }
//       }
      
//       const currentValue = parseInt(hash[field] || 0);
//       hash[field] = currentValue + increment;
//       store.set(key, JSON.stringify(hash));
//       return Promise.resolve(hash[field]);
//     },
//     ping: () => Promise.resolve('PONG'),
//     keys: (pattern) => {
//       const keys = Array.from(store.keys()).filter(key => {
//         // Simple pattern matching for * wildcard
//         const regex = new RegExp(pattern.replace(/\*/g, '.*'));
//         return regex.test(key);
//       });
//       return Promise.resolve(keys);
//     },
//     connected: false
//   };
//   console.log('Using mock Redis for MVP');
// }

// export default redisClient;
