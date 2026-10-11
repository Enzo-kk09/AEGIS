"""Run synchronous CommonJS utility cases in Chromium when Node is unavailable."""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', default=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser,headless=True)
        page = browser.new_page()
        cases = []
        sources = {name:(root/name).read_text(encoding='utf-8') for name in ['AegisShared.js','DeveloperTest.js','DeveloperTest.Report.js','DeveloperTest.Temporal.js']}
        for module_name, test_name in [('AegisShared.js','aegis_shared.test.cjs'),('DeveloperTest.js','developer_frontend.test.cjs'),('DeveloperTest.Report.js','developer_report.test.cjs'),('DeveloperTest.Temporal.js','developer_temporal.test.cjs')]:
            result = page.evaluate('''({sources, tests, moduleName}) => {
                const modules = {};
                const load = name => {
                    if(!Object.hasOwn(sources,name)) throw new Error('Unexpected source '+name);
                    if(!modules[name]) {
                        const module = {exports:{}};
                        modules[name] = module;
                        new Function('module','document',sources[name])(module,undefined);
                    }
                    return modules[name].exports;
                };
                load(moduleName);
                const results = [];
                const test = (name, callback) => {
                    try { callback(); results.push({name, passed:true}); }
                    catch(error) { results.push({name, passed:false, error:error.message}); }
                };
                const assert = {
                    equal(actual,expected) { if(!Object.is(actual,expected)) throw new Error(`Expected ${expected}; received ${actual}`); },
                    notEqual(actual,expected) { if(Object.is(actual,expected)) throw new Error('Values unexpectedly equal'); },
                    deepEqual(actual,expected) { if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error('Objects differ'); },
                    ok(value) { if(!value) throw new Error('Value is not truthy'); },
                    match(value,pattern) { if(!pattern.test(value)) throw new Error('Pattern did not match'); },
                    throws(callback,expected) {
                        let thrown;
                        try { callback(); } catch(error) { thrown = error; }
                        if(!thrown) throw new Error('Expected an exception');
                        if(expected) for(const key of Object.keys(expected)) if(thrown[key]!==expected[key]) throw new Error('Unexpected exception '+key);
                    }
                };
                const require = name => {
                    if(name==='node:test') return test;
                    if(name==='node:assert/strict') return assert;
                    if(name.startsWith('./')) return load(name.slice(2));
                    throw new Error('Unexpected module '+name);
                };
                new Function('require',tests)(require);
                return results;
            }''', {'sources':sources,'tests':(root/test_name).read_text(encoding='utf-8'),'moduleName':module_name})
            cases.extend(result)
        browser.close()
    failed = [case for case in cases if not case['passed']]
    assert not failed, failed
    print(f'{len(cases)} synchronous JavaScript utility cases passed in Chromium (assertion adapter, not Node test runner).')


if __name__ == '__main__':
    main()
