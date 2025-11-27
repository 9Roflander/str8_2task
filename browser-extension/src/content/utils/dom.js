/**
 * Wait for an element to appear in the DOM
 * @param {string|string[]} selectors - CSS selector(s) to wait for
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<Element>} The found element
 */
export function waitForElement(selectors, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
        const startTime = Date.now();
        let attempts = 0;

        const check = () => {
            attempts++;

            for (const selector of selectorArray) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    resolve(element);
                    return;
                }
            }

            if (Date.now() - startTime >= timeout) {
                reject(new Error(`Element not found with selectors: ${selectorArray.join(', ')} after ${attempts} attempts`));
                return;
            }

            setTimeout(check, 200);
        };

        check();
    });
}
