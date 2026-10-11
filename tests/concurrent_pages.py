"""Four concurrent tabs must load their scripts and health without static 503s."""
import argparse
import asyncio
from playwright.async_api import async_playwright, expect


async def main(base_url):
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        errors=[]
        async def open_tab(index):
            context=await browser.new_context()
            page=await context.new_page()
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('response',lambda response:errors.append(f'{response.status}: {response.url}') if response.status>=400 else None)
            await page.goto(base_url+'/DeveloperTest.html',wait_until='networkidle')
            await expect(page.locator('#dev-health-label')).to_have_text('Python conectado')
            await expect(page.locator('#dev-start')).to_be_enabled()
            await context.close()
        await asyncio.gather(*(open_tab(index) for index in range(4)))
        await browser.close()
        assert not errors,errors
    print('Four concurrent laboratory tabs loaded all resources, controls and health without errors; read-only test.')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://127.0.0.1:8765')
    args=parser.parse_args()
    asyncio.run(main(args.base_url))
