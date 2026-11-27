# ระบบลงทะเบียนเพื่อคัดเลือกนักเรียนระดับอนุบาล (รองรับหลายปีการศึกษา)

เว็บแอปสำหรับเจ้าหน้าที่ค้นหารหัส ตรวจสอบรอบ ถ่ายภาพยืนยัน และบันทึกเวลาลงทะเบียน ฐานข้อมูลและ storage ใช้ Supabase ส่วนการเข้าสู่ระบบตรวจสอบโดย backend ของแอปเอง ไม่ใช้ Supabase Authentication

## ตั้งค่าระบบ

1. ใช้ Supabase project ของระบบนี้ และรัน migrations ตามลำดับผ่าน Supabase CLI หรือ SQL Editor:
   - `supabase/migrations/20261124100000_create_registration_checkins.sql`
   - `supabase/migrations/20261125100000_custom_staff_auth.sql`
   - `supabase/migrations/20261125110000_staff_accounts_and_admin.sql`
   - `supabase/migrations/20261125120000_checkin_corrections.sql`
   - `supabase/migrations/20261125130000_activate_staff_signup.sql`
   - `supabase/migrations/20261125140000_grant_service_role_checkin_access.sql`
   - `supabase/migrations/20261125150000_search_registrations_by_name.sql`
   - `supabase/migrations/20261126100000_staff_account_management_roles.sql`
   - `supabase/migrations/20261126110000_staff_login_id_optional_email.sql`
   - `supabase/migrations/20261126120000_checkin_notes.sql`
   - `supabase/migrations/20261127100000_academic_years_and_schedules.sql`
   - `supabase/migrations/20261127110000_allow_multiple_admins.sql`
   migration `20261127110000_allow_multiple_admins.sql` อนุญาตให้แอดมินทั่วไปสร้างบัญชีแอดมินเพิ่มได้ โดยแอดมินยังจัดการบัญชีแอดมินคนอื่นไม่ได้
   migration `20261125110000_staff_accounts_and_admin.sql` จะนำเข้าบัญชีที่มีรหัสผ่านจาก Supabase Authentication เดิม โดยคง password hash เดิมไว้ บัญชีเดิมจะถูกนำเข้าเป็นเจ้าหน้าที่ที่ active แต่ยังไม่มีสิทธิ์แอดมิน
2. กำหนดบัญชีแอดมินใหญ่เริ่มต้นใน SQL Editor โดยตรวจสอบก่อนว่าเป็นบัญชีของคุณ แล้วรันคำสั่งนี้:

   ```sql
   update public.staff_accounts
   set role = 'superadmin', status = 'active'
   where email = lower('admin@gmail.com')
     and role in ('admin', 'staff');
   ```

   ตรวจสอบว่าคำสั่งอัปเดตบัญชีได้ 1 แถว หากไม่ใช่ 1 แถว ให้ตรวจสอบบัญชีก่อนดำเนินการต่อ หากไม่มีบัญชีนี้ ให้สร้างบัญชีแอดมินใหญ่เริ่มต้นด้วย SQL โดยแทน ID อีเมล ชื่อ และรหัสผ่านด้วยข้อมูลที่ต้องการ:

   ```sql
   insert into public.staff_accounts (
     login_id, email, display_name, password_hash, password_hash_scheme, role, status
   )
   values (
     'admin@gmail.com',
     'admin@gmail.com',
     'ผู้ดูแลระบบ',
     extensions.crypt(
       pg_catalog.encode(extensions.digest('staff-password-v1:' || 'replace-with-a-strong-password', 'sha256'), 'hex'),
       extensions.gen_salt('bf', 12)
     ),
     'bcrypt-sha256',
     'superadmin',
     'active'
   );
   ```

3. ปิดการสมัครสมาชิกด้วยตนเองแล้ว ให้เพิ่มบัญชีผ่านเมนู “จัดการระบบ” เท่านั้น ตอนเพิ่มบัญชีต้องกำหนด ID และรหัสผ่าน (ห้ามเว้นว่าง แต่ไม่บังคับความยาวขั้นต่ำ) ส่วนอีเมลเป็นช่องไม่บังคับ ใช้ ID และรหัสผ่านเข้าสู่ระบบ บัญชีเดิมที่สร้างก่อน migration นี้ใช้ email เดิมเป็น ID ไปก่อน แอดมินใหญ่จัดการบัญชีได้ทุกระดับ ส่วนแอดมินทั่วไปสร้างบัญชีแอดมินหรือเจ้าหน้าที่ได้ และจัดการบัญชีเจ้าหน้าที่ได้ รหัสผ่านจะถูกแฮชก่อนบันทึก
4. แดชบอร์ดมีหน้า “ภาพรวม”, “ค้นหา” และ “ผู้ที่ลงทะเบียนแล้ว” สลับหน้าได้จากเมนูด้านบน และระบบจำหน้าที่เลือกไว้ใน URL หน้า “ภาพรวม” แสดงยอดลงทะเบียนรวมและแบ่งกลุ่มเป็น 5 รอบ รอบละ 6 กลุ่ม ใช้สีประจำกลุ่มวนซ้ำตามตาราง พร้อมเวลาลงทะเบียนและเวลาทำกิจกรรม กดกลุ่มเพื่อเปิดหน้าแสดงรายชื่อเฉพาะกลุ่มได้ทันที หน้า “ค้นหา” แสดงช่องค้นหาและปุ่มเลือกกลุ่ม โดยไม่แสดงรายชื่อจนกว่าจะเลือกผลค้นหาหรือกลุ่ม รายชื่อกลุ่มและข้อมูลผู้สมัคร/การลงทะเบียนแสดงในหน้าแยกกัน พร้อมค้นหาด้วยรหัสบางส่วน ชื่อ หรือนามสกุล ส่วนหน้า “ผู้ที่ลงทะเบียนแล้ว” ค้นหารายการด้วยรหัสหรือชื่อได้ เจ้าหน้าที่ที่เข้าสู่ระบบสามารถยกเลิกการลงทะเบียนที่ผิด โดยต้องระบุเหตุผล ระบบเก็บประวัติการยกเลิกไว้และอนุญาตให้ลงทะเบียนผู้สมัครคนนั้นใหม่ได้
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

- ถ้าขึ้นว่า ID หรือรหัสผ่านไม่ถูกต้อง บัญชีอาจยังไม่ได้ถูกนำเข้าจาก Supabase Authentication เดิม (รัน migration `20261125110000_staff_accounts_and_admin.sql`) หรือรหัสผ่านไม่ตรงกับบัญชี
- ถ้าระบบแจ้งว่าฐานข้อมูลตั้งค่าไม่ครบ ให้ตรวจว่ารัน migrations ทั้งสิบสองตามลำดับ และตาราง `staff_accounts`/ฟังก์ชัน `verify_staff_login` มีอยู่
- ถ้าแจ้ง environment variables ให้ตั้ง `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` และ `SESSION_SECRET` ใน environment ฝั่ง server (รวมถึง Vercel Project Settings > Environment Variables เมื่อนำขึ้น production) แล้ว redeploy
- ข้อผิดพลาดอื่นให้ดู function logs ใน Vercel หรือ terminal ที่รัน `npm run dev`; รายละเอียดภายในจะไม่ถูกส่งกลับไปยังหน้าเว็บ

## นำเข้ารายชื่อจาก Excel

แปลง Excel เป็น CSV ที่ใช้ชื่อคอลัมน์และรูปแบบเวลาตรงกับตาราง `registrations` สำหรับนำเข้าผ่าน Supabase Dashboard:

```powershell
npm.cmd run import:registrations -- --export-csv "C:\path\to\registration.xlsx"
```

ระบบจะสร้างไฟล์ `_supabase.csv` ข้างไฟล์ต้นฉบับโดยไม่แก้หรือลบต้นฉบับ จากนั้นเปิด Supabase Dashboard → **Table Editor** → `registrations` → **Import data from CSV** แล้วเลือก CSV ที่สร้าง

แอดมินสามารถจัดการข้อมูลนักเรียนจากปุ่ม **จัดการข้อมูลนักเรียน** ในหน้าเว็บ เพื่อส่งออกรายชื่อนักเรียนเป็น CSV หรือเลือก CSV เพื่อนำเข้าได้ การนำเข้าจะเพิ่มรายการใหม่และอัปเดตรายการเดิมที่มี `application_code` ตรงกัน โดยไม่แก้ประวัติการลงทะเบียน ไฟล์ต้องมีคอลัมน์ `application_code`, `application_year`, `title`, `first_name`, `last_name`, `group_number`, `slot_text`, `slot_start` และ `slot_end`; รับไฟล์ CSV ไม่เกิน 5 MB และไม่รวมข้อมูลเช็กอินหรือบัญชีผู้ใช้

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
2. แก้ไขหน้า dasbord ใหมันมีการแยกการค้นหากับผู้ที่ลงทะเบียนแล้ว
3. deploy vercal demo #   i t p c - r e s i s t e r 
 
 