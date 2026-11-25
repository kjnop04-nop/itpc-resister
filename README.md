# ระบบลงทะเบียนเพื่อพิจารณาความพร้อมของนักเรียนเพื่อเข้าศึกษาต่อในระดับอนุบาล 1

เว็บแอปสำหรับเจ้าหน้าที่ค้นหารหัส ตรวจสอบรอบ ถ่ายภาพยืนยัน และบันทึกเวลาเช็กอิน ฐานข้อมูลและ storage ใช้ Supabase ส่วนการเข้าสู่ระบบตรวจสอบโดย backend ของแอปเอง ไม่ใช้ Supabase Authentication

## ตั้งค่าระบบ

1. ใช้ Supabase project ของระบบนี้ และรัน migrations ตามลำดับผ่าน Supabase CLI หรือ SQL Editor:
   - `supabase/migrations/20261124100000_create_registration_checkins.sql`
   - `supabase/migrations/20261125100000_custom_staff_auth.sql`
   - `supabase/migrations/20261125110000_staff_accounts_and_admin.sql`
   - `supabase/migrations/20261125120000_checkin_corrections.sql`
   - `supabase/migrations/20261125130000_activate_staff_signup.sql`
   - `supabase/migrations/20261125140000_grant_service_role_checkin_access.sql`
   - `supabase/migrations/20261125150000_search_registrations_by_name.sql`
   migration `20261125110000_staff_accounts_and_admin.sql` จะนำเข้าบัญชีที่มีรหัสผ่านจาก Supabase Authentication เดิม โดยคง password hash เดิมไว้ บัญชีเดิมจะถูกนำเข้าเป็นเจ้าหน้าที่ที่ active แต่ยังไม่มีสิทธิ์แอดมิน
2. กำหนดแอดมินเริ่มต้นใน SQL Editor โดยแทนอีเมลด้วยบัญชีเดิมที่เชื่อถือได้:

   ```sql
   update public.staff_accounts
   set role = 'admin', status = 'active'
   where email = lower('admin@example.com');
   ```

   ตรวจสอบว่าคำสั่งอัปเดตบัญชีได้ 1 แถว หากไม่มีบัญชีเดิม ให้สร้างบัญชีแอดมินด้วย SQL โดยใส่อีเมล ชื่อ และรหัสผ่านใหม่:

   ```sql
   insert into public.staff_accounts (email, display_name, password_hash, role, status)
   values (
     'admin@example.com',
     'ผู้ดูแลระบบ',
     extensions.crypt('replace-with-a-strong-password', extensions.gen_salt('bf', 12)),
     'admin',
     'active'
   );
   ```

3. สมัครสมาชิกจากหน้าเข้าสู่ระบบ บัญชีใหม่ใช้งานได้ทันทีด้วยสิทธิ์เจ้าหน้าที่ บัญชีที่ค้างรออนุมัติจะถูกเปิดใช้งานเมื่อรัน migration `20261125130000_activate_staff_signup.sql` แอดมินยังสามารถระงับ/เปิดบัญชี เปลี่ยนสิทธิ์เจ้าหน้าที่หรือแอดมิน และลบบัญชีได้ ระบบป้องกันไม่ให้แอดมินลบบัญชีตัวเองหรือเอาสิทธิ์แอดมินออกจากแอดมินคนสุดท้าย
4. แดชบอร์ดแยกเป็นหน้า “ค้นหาและเช็กชื่อ” กับ “ผู้ที่เช็กอินแล้ว” สลับหน้าได้จากเมนูด้านบน และระบบจำหน้าที่เลือกไว้ใน URL ค้นหาผู้สมัครได้ด้วยรหัสบางส่วน ชื่อ หรือนามสกุล และค้นหารายการเช็กอินด้วยรหัสหรือชื่อได้ เจ้าหน้าที่ที่เข้าสู่ระบบสามารถยกเลิกการเช็กอินที่ผิด โดยต้องระบุเหตุผล ระบบเก็บประวัติการยกเลิกไว้และอนุญาตให้เช็กอินผู้สมัครคนนั้นใหม่ได้
5. สร้าง `.env.local` จาก `.env.example` และกำหนด `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` และ `SESSION_SECRET` ฝั่ง server เท่านั้น ห้ามใช้ prefix `VITE_` กับ secrets:

   ```powershell
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   [Convert]::ToBase64String($bytes)
   ```

   นำผลลัพธ์ไปตั้งเป็น `SESSION_SECRET` (อย่างน้อย 32 ตัวอักษร) และใช้ service-role key เฉพาะใน environment ของ backend/Vercel ห้ามส่ง key นี้ไปยัง browser หรือ commit ลง source code
6. ติดตั้งและเปิดแอป:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

กล้องต้องใช้ `localhost` หรือ HTTPS และผู้ใช้ต้องอนุญาตการเข้าถึงกล้อง API ทำงานเป็น Vercel Functions; `npm run dev` ลงทะเบียน API เหล่านี้กับ Vite เพื่อพัฒนาในเครื่อง Cookie ของ session เป็น HttpOnly, SameSite=Strict และหมดอายุใน 8 ชั่วโมง

### แก้ปัญหาเข้าสู่ระบบ

- ถ้าขึ้นว่าอีเมลหรือรหัสผ่านไม่ถูกต้อง บัญชีอาจยังไม่ได้ถูกนำเข้าจาก Supabase Authentication เดิม (รัน migration `20261125110000_staff_accounts_and_admin.sql`) หรือรหัสผ่านไม่ตรงกับบัญชี
- ถ้าระบบแจ้งว่าฐานข้อมูลตั้งค่าไม่ครบ ให้ตรวจว่ารัน migrations ทั้งเจ็ดตามลำดับ และตาราง `staff_accounts`/ฟังก์ชัน `verify_staff_login` มีอยู่
- ถ้าแจ้ง environment variables ให้ตั้ง `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` และ `SESSION_SECRET` ใน environment ฝั่ง server (รวมถึง Vercel Project Settings > Environment Variables เมื่อนำขึ้น production) แล้ว redeploy
- ข้อผิดพลาดอื่นให้ดู function logs ใน Vercel หรือ terminal ที่รัน `npm run dev`; รายละเอียดภายในจะไม่ถูกส่งกลับไปยังหน้าเว็บ

## นำเข้ารายชื่อจาก Excel

แปลง Excel เป็น CSV ที่ใช้ชื่อคอลัมน์และรูปแบบเวลาตรงกับตาราง `registrations` สำหรับนำเข้าผ่าน Supabase Dashboard:

```powershell
npm.cmd run import:registrations -- --export-csv "C:\path\to\registration.xlsx"
```

ระบบจะสร้างไฟล์ `_supabase.csv` ข้างไฟล์ต้นฉบับโดยไม่แก้หรือลบต้นฉบับ จากนั้นเปิด Supabase Dashboard → **Table Editor** → `registrations` → **Import data from CSV** แล้วเลือก CSV ที่สร้าง

ตรวจสอบไฟล์โดยไม่สร้าง CSV ได้ด้วย:

```powershell
npm.cmd run import:registrations -- --dry-run "C:\path\to\registration.xlsx"
```

กำหนด service-role key ใน PowerShell เฉพาะ session ที่ใช้ import แล้วส่ง path ไปยังไฟล์ Excel:

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
npm.cmd run import:registrations -- "C:\path\to\registration.xlsx"
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

สคริปต์อ่านหัวคอลัมน์ `รหัสรับสมัคร`, `ปีการสมัคร`, `คำนำหน้า`, `ชื่อ`, `นามสกุล`, `กลุ่มนักเรียน (กิจกรรม)` และ `เวลากลุ่มนักเรียน (กิจกรรม)` ตรวจข้อมูลก่อนนำเข้า และ upsert ด้วยรหัสรับสมัคร ไม่คัดลอกรายชื่อหรือ service-role key ลงใน source code

## ทดสอบ

```powershell
npm.cmd test
npm.cmd run build
```
1. เพิ่มระบบlogin ไม่ต้องไปใช่ ของ supabase
2. แก้ไขหน้า dasbord ใหมันมีการแยกการค้นหากับคนที่เช็คอินไปแล้ว 
3. deploy vercal demo #   i t p c - r e s i s t e r  
 