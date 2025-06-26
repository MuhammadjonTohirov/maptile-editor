#!/usr/bin/env python3
import httpx
import asyncio

async def test_overpass():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get('https://overpass-api.de/api/status')
            print(f'overpass-api.de Status: {response.status_code}')
            
            response2 = await client.get('https://overpass.kumi.systems/api/status')
            print(f'overpass.kumi.systems Status: {response2.status_code}')
            
            response3 = await client.get('https://overpass.openstreetmap.ru/api/status')
            print(f'overpass.openstreetmap.ru Status: {response3.status_code}')
            
    except Exception as e:
        print(f'Connection error: {e}')

if __name__ == '__main__':
    asyncio.run(test_overpass())