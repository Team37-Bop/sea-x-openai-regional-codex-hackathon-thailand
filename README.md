# Bop

Bop ช่วยกลุ่มเพื่อนวางทริปโดยใช้เวลาเดินทาง ที่พัก งบและความต้องการของแต่ละคน ผู้จัดเห็นแผนรายวันบนแผนที่ ตรวจเงื่อนไขร่วมกัน และโหวตเมื่อการปรับแผนมีผลกับสมาชิก

## เปิดบนเครื่อง

ใช้ Node.js 24 และ npm จากโฟลเดอร์โครงการ

```sh
npm ci
npm run build
npm start
```

เปิด [หน้าตั้งค่าทริป](http://localhost:8787/) เพื่อเริ่มวางแผน แผนที่พื้นหลังใช้ไทล์จาก OpenFreeMap ผ่านอินเทอร์เน็ต

หากต้องการสร้างทริปด้วย OpenAI ให้คัดลอก `.env.example` เป็น `.env.local` ตั้ง `BOP_PROVIDER=openai` กับ `OPENAI_API_KEY` แล้วเริ่มเซิร์ฟเวอร์ใหม่ โหมด `BOP_FAKE_LLM=1` ใช้ข้อมูลทดสอบเพื่อเดินผ่านหน้าสร้างทริปและเลือกสถานที่ ส่วน Anthropic API และ Claude CLI เลือกได้ด้วย `BOP_PROVIDER` ตรวจโหมดที่เลือกได้ที่ [สถานะบริการ](http://localhost:8787/api/health)

สำหรับเครื่องที่ใช้เดโม ตั้ง `HOST=127.0.0.1` และ `BOP_LOCAL_DEMO=1` เพื่อเปิดทริปที่สร้างเสร็จจากลิงก์เดิม แม้รีสตาร์ตแอป ข้อมูลแผน 8 ทริปล่าสุดอยู่ใน `server/.cache/showcase/` บนเครื่องนั้น

## งานที่ลองได้

- ตั้งปลายทาง วันเดินทาง โรงแรมหลายแห่ง อาหารที่เลี่ยง งบ และระยะเดินของสมาชิกแต่ละคน
- ให้ Bop จัดแผนทันที หรือให้กลุ่มเลือกสถานที่ก่อน ดูความคืบหน้ารายวัน ค่าใช้จ่าย ระยะเดิน เงื่อนไข และแหล่งข้อมูลสถานที่
- สลับแผนที่รายวันกับทั้งทริป เส้นประแสดงช่วงที่ประเมินจากพิกัด ดูการพยากรณ์ฝนจาก Open-Meteo แล้วเลือกว่าจะปรับแผนหรือไม่
- ดูตัวอย่างทางเลือก โหวต ย้อนการแก้ไข และติดตามการจองในแท็บการจอง
- เมื่อกำหนดค่า LINE แล้ว เชื่อมกลุ่มและโหวตผ่านข้อความหรือ LIFF เมื่อใช้ Duffel test token ให้ลองค้นข้อเสนอ ตรวจราคาสุทธิและสัมภาระ ยืนยันจอง หรือขอราคาและยืนยันการยกเลิกแยกกัน
- ปลายทาง LINE webhook คือ `/api/line/webhook` และ LIFF คือ `/liff.html` การเปิดจองตั๋วจริงนอกเครื่องต้องมีการยืนยันตัวตนจาก API Gateway authorizer

## ตรวจ build

```sh
npm test
openspec validate --all --strict --no-interactive
npm run package:lambda
```

คำสั่งแพ็กติดตั้ง dependencies จาก lockfile ทดสอบแอป ตรวจช่องโหว่ระดับ high ของ dependencies ที่ใช้จริง และสร้างเว็บใน `dist/` จากรายการไฟล์สาธารณะที่กำหนดไว้ใน `scripts/build.mjs` เมื่อเพิ่มไฟล์หน้าเว็บให้เพิ่มชื่อในรายการนั้นด้วย ตัวแพ็กตรวจ MapLibre worker และทดสอบ health กับการสตรีมแผนสามวันจาก Lambda ที่บันเดิลใน `.build/lambda/`

GitHub Actions ตรวจ pull request และใช้ OIDC เพื่อ deploy จาก main ไปยัง CloudFront, private S3, API Gateway และ Lambda ทำตาม [คู่มือ Terraform](terraform/README.md) สำหรับ bootstrap, repository variables, การเลือก runtime secret, การตรวจผล และ rollback

[OpenSpec ทั้ง 15 ส่วน](openspec/README.md) ระบุพฤติกรรมและเกณฑ์ทดสอบของการเขียนแอปใหม่ ทักษะ OpenSpec สำหรับ Codex อยู่ใน `.codex/skills/`

เส้นทางตัวอย่างเชียงใหม่ใช้ข้อมูล © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) และคำนวณผ่าน [OSRM บน routing.openstreetmap.de](https://routing.openstreetmap.de/)
