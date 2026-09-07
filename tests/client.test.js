import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backend} from '../client.js';

test('network errors explain phone loopback and CORS without exposing credentials',async t=>{
    t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});
    try {await backend({backendUrl:'http://127.0.0.1:8001',backendKey:'private-test-key'},'/characters');assert.fail('Expected a network error');}
    catch(error){
        assert.equal(error.diagnostics.httpStatus,null);
        assert.equal(error.diagnostics.category,'network');
        assert.ok(error.diagnostics.hints.some(h=>h.includes('phone')));
        assert.ok(error.diagnostics.hints.some(h=>h.includes('CORS_ORIGINS')));
        assert.equal(JSON.stringify(error).includes('private-test-key'),false);
    }
});
test('authentication and wrong-server responses are distinct from network errors',async t=>{
    t.mock.method(globalThis,'fetch',async()=>new Response('Unauthorized',{status:401}));
    await assert.rejects(()=>backend({backendUrl:'http://localhost:8001',backendKey:'bad'},'/characters'),error=>error.status===401&&error.diagnostics.httpStatus===401);
    globalThis.fetch=async()=>new Response('<html>SillyTavern</html>',{headers:{'Content-Type':'text/html'}});
    await assert.rejects(()=>backend({backendUrl:'http://localhost:8000'},'/characters'),error=>error.diagnostics.category==='invalid-response');
});
test('a key pasted into the address field gets an actionable error',async()=>{
    await assert.rejects(()=>backend({backendUrl:'not-a-url'},'/characters'),/Enter the key in RPG API key/);
});
