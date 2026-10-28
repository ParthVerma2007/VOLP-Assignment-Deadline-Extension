/**
 * Native Web Crypto API implementation for secure local encryption.
 * Algorithm: AES-GCM (256-bit) with PBKDF2 (SHA-256, 100,000 iterations).
 * Credentials are NEVER sent across network. Only saved locally encrypted.
 */

const VolpCrypto = (function () {
    const ALGORITHM = 'AES-GCM';
    const KEY_LENGTH = 256;
    const PBKDF2_ITERATIONS = 100000;
    const STORAGE_KEY = 'volp_secure_creds';
    const DEVICE_KEY_NAME = 'volp_device_salt';

    function bufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    async function getOrCreateDeviceSalt() {
        return new Promise((resolve) => {
            chrome.storage.local.get([DEVICE_KEY_NAME], (res) => {
                if (res[DEVICE_KEY_NAME]) {
                    resolve(base64ToBuffer(res[DEVICE_KEY_NAME]));
                } else {
                    const salt = crypto.getRandomValues(new Uint8Array(16));
                    const b64 = bufferToBase64(salt.buffer);
                    chrome.storage.local.set({ [DEVICE_KEY_NAME]: b64 }, () => {
                        resolve(salt.buffer);
                    });
                }
            });
        });
    }

    async function deriveKey(passphrase, saltBuffer) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(passphrase),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: ALGORITHM, length: KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encrypt(plainText, passphrase) {
        const saltBuffer = await getOrCreateDeviceSalt();
        const key = await deriveKey(passphrase, saltBuffer);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encodedData = enc.encode(plainText);

        const cipherBuffer = await crypto.subtle.encrypt(
            { name: ALGORITHM, iv: iv },
            key,
            encodedData
        );

        return {
            ciphertext: bufferToBase64(cipherBuffer),
            iv: bufferToBase64(iv.buffer),
            salt: bufferToBase64(saltBuffer)
        };
    }

    async function decrypt(payload, passphrase) {
        const saltBuffer = base64ToBuffer(payload.salt);
        const ivBuffer = base64ToBuffer(payload.iv);
        const cipherBuffer = base64ToBuffer(payload.ciphertext);

        const key = await deriveKey(passphrase, saltBuffer);

        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: ALGORITHM, iv: ivBuffer },
            key,
            cipherBuffer
        );

        const dec = new TextDecoder();
        return dec.decode(decryptedBuffer);
    }

    return {
        saveCredentials: async function (email, password, masterKey = '') {
            const secret = masterKey ? `pin:${masterKey}` : 'volp_local_device_key';
            const payload = JSON.stringify({ email, password, savedAt: Date.now() });
            const encrypted = await encrypt(payload, secret);

            return new Promise((resolve) => {
                chrome.storage.local.set({ [STORAGE_KEY]: encrypted }, () => {
                    resolve(true);
                });
            });
        },

        loadCredentials: async function (masterKey = '') {
            const secret = masterKey ? `pin:${masterKey}` : 'volp_local_device_key';
            return new Promise((resolve, reject) => {
                chrome.storage.local.get([STORAGE_KEY], async (res) => {
                    const encrypted = res[STORAGE_KEY];
                    if (!encrypted) {
                        return resolve(null);
                    }
                    try {
                        const jsonStr = await decrypt(encrypted, secret);
                        const creds = JSON.parse(jsonStr);
                        resolve(creds);
                    } catch (err) {
                        reject(new Error('Decryption failed. Invalid master key or corrupted data.'));
                    }
                });
            });
        },

        hasCredentials: async function () {
            return new Promise((resolve) => {
                chrome.storage.local.get([STORAGE_KEY], (res) => {
                    resolve(!!res[STORAGE_KEY]);
                });
            });
        },

        clearCredentials: async function () {
            return new Promise((resolve) => {
                chrome.storage.local.remove([STORAGE_KEY], () => {
                    resolve(true);
                });
            });
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolpCrypto;
}
