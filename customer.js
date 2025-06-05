let currentUser = null;
let selectedBooths = [];

async function initializeCustomer() {
    try {
        const userResponse = await fetch('http://localhost:3000/user', {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
        });
        currentUser = await userResponse.json();
        initializeProfile();
        initializeBoothMap();
        populateWattageOptions();
        updateBookingHistory();
        document.querySelector("select[name='wattage']").addEventListener("change", calculatePrice);
        document.getElementById("confirmBoothsButton").addEventListener("click", showBookingForm);
    } catch (error) {
        console.error('Error fetching user:', error);
        alert('เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้');
    }
}

async function initializeProfile() {
    try {
        document.getElementById("profileUsername").value = currentUser.username;
        document.getElementById("profileEmail").value = currentUser.email || '';
        document.getElementById("profileInstitute").value = currentUser.institute_name;
        document.getElementById("profileForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            const updatedUser = {
                username: document.getElementById("profileUsername").value,
                email: document.getElementById("profileEmail").value,
                password: document.getElementById("profilePassword").value || undefined,
                institute_name: document.getElementById("profileInstitute").value
            };
            try {
                const response = await fetch('http://localhost:3000/user', {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('token')
                    },
                    body: JSON.stringify(updatedUser)
                });
                if (!response.ok) throw new Error('Failed to update profile');
                currentUser = await response.json();
                alert('บันทึกโปรไฟล์สำเร็จ!');
            } catch (error) {
                console.error('Error updating profile:', error);
                alert('เกิดข้อผิดพลาดในการบันทึกโปรไฟล์');
            }
        });
    } catch (error) {
        console.error('Error initializing profile:', error);
        alert('เกิดข้อผิดพลาดในการโหลดโปรไฟล์');
    }
}

async function initializeBoothMap() {
    try {
        const response = await fetch('http://localhost:3000/booths');
        const booths = await response.json();
        const boothMap = document.getElementById("boothMap");
        boothMap.innerHTML = "";
        selectedBooths = [];
        booths.forEach(booth => {
            const boothDiv = document.createElement("div");
            boothDiv.className = `p-4 rounded ${booth.status === 'available' ? 'bg-green-200' : 'bg-red-200'} ${selectedBooths.includes(booth.booth_id) ? 'border-4 border-blue-500' : ''}`;
            boothDiv.innerHTML = `
                <p>บูธ ${booth.booth_id}</p>
                <p>สถานะ: ${booth.status === 'available' ? 'ว่าง' : 'จองแล้ว'}</p>
            `;
            boothDiv.addEventListener("click", () => {
                if (booth.status === "available") {
                    toggleBoothSelection(booth.booth_id);
                    boothDiv.classList.toggle('border-4');
                    boothDiv.classList.toggle('border-blue-500');
                    document.getElementById("confirmBoothsButton").classList.toggle("hidden", selectedBooths.length === 0);
                } else {
                    alert("บูธนี้ถูกจองแล้ว!");
                }
            });
            boothMap.appendChild(boothDiv);
        });
    } catch (error) {
        console.error('Error loading booth map:', error);
        alert('เกิดข้อผิดพลาดในการโหลดแผนผังบูธ');
    }
}

function toggleBoothSelection(boothId) {
    if (selectedBooths.includes(boothId)) {
        selectedBooths = selectedBooths.filter(id => id !== boothId);
    } else {
        selectedBooths.push(boothId);
    }
}

async function populateWattageOptions() {
    try {
        const response = await fetch('http://localhost:3000/electricities');
        const electricities = await response.json();
        const wattageSelect = document.querySelector("select[name='wattage']");
        wattageSelect.innerHTML = '<option value="0">ไม่เพิ่ม</option>';
        electricities.forEach(e => {
            const opt = document.createElement("option");
            opt.value = e.electricity_quantity;
            opt.textContent = `${e.electricity_quantity} วัตต์ (+${e.electricity_price} บาท)`;
            wattageSelect.appendChild(opt);
        });
    } catch (error) {
        console.error('Error loading wattage options:', error);
        alert('เกิดข้อผิดพลาดในการโหลดตัวเลือกกำลังวัตต์');
    }
}

async function showBookingForm() {
    if (selectedBooths.length === 0) {
        alert("กรุณาเลือกบูธอย่างน้อย 1 บูธ");
        return;
    }

    try {
        // ตรวจสอบ booth_max
        const configResponse = await fetch('http://localhost:3000/config');
        const config = await configResponse.json();
        const bookingsResponse = await fetch('http://localhost:3000/bookings');
        const bookings = await bookingsResponse.json();
        const userBookings = bookings.filter(b => b.booking_status !== 'cancelled' && b.user_id === currentUser.user_id).length;
        const boothMax = config.length > 0 ? config[0].booth_max : 2;
        if (userBookings + selectedBooths.length > boothMax) {
            alert(`คุณจองบูธครบ ${boothMax} บูธแล้ว! สามารถจองได้อีก ${boothMax - userBookings} บูธ`);
            return;
        }

        document.getElementById("bookingFormSection").classList.remove("hidden");
        document.getElementById("boothNumbers").value = selectedBooths.join(", ");
        document.getElementById("boothQuantity").value = selectedBooths.length;
        document.getElementById("bookingDatetime").value = new Date().toISOString().slice(0, 16);
        document.getElementById("bookingStatus").value = "pending";
        document.getElementById("createdAt").value = new Date().toISOString().slice(0, 16);
        document.getElementById("staffCount").value = 2;

        // สร้างฟิลด์ booth_nameplate สำหรับแต่ละบูธ
        const nameplatesContainer = document.getElementById("boothNameplates");
        nameplatesContainer.innerHTML = '<label class="block text-sm font-medium mb-2">ป้ายชื่อหน้าบูธ</label>';
        selectedBooths.forEach(boothId => {
            const div = document.createElement("div");
            div.innerHTML = `
                <label class="block text-sm">บูธ ${boothId}</label>
                <input type="text" name="nameplate-${boothId}" class="w-full p-2 border rounded mb-2" value="บูธ${currentUser.institute_name}-${boothId}" required>
            `;
            nameplatesContainer.appendChild(div);
        });

        calculatePrice();
    } catch (error) {
        console.error('Error showing booking form:', error);
        alert('เกิดข้อผิดพลาดในการแสดงฟอร์มจอง');
    }
}

async function calculatePrice() {
    try {
        const wattage = parseInt(document.querySelector("select[name='wattage']").value);
        const today = new Date().toISOString().split("T")[0];

        // ดึง institute และ type
        const instituteResponse = await fetch(`http://localhost:3000/institutes/${encodeURIComponent(currentUser.institute_name)}`);
        const institute = await instituteResponse.json();
        const typeResponse = await fetch(`http://localhost:3000/types/${institute.type_id}`);
        const type = await typeResponse.json();

        let basePrice = parseFloat(type.price) * selectedBooths.length;

        // ตรวจสอบส่วนลด early_bird
        const earlyBirdStart = '2025-05-01';
        const earlyBirdEnd = '2025-05-10';
        if (institute.type_id === 'T001' && today >= earlyBirdStart && today <= earlyBirdEnd) {
            basePrice = basePrice * 0.8;
        }

        // คำนวณค่าไฟ
        let wattageCost = 0;
        if (wattage > 0) {
            const electricityResponse = await fetch('http://localhost:3000/electricities');
            const electricities = await electricityResponse.json();
            const wattageOption = electricities.find(e => e.electricity_quantity === wattage);
            wattageCost = wattageOption ? wattageOption.electricity_price * selectedBooths.length : 0;
        }

        document.getElementById("totalPrice").value = `${(basePrice + wattageCost).toFixed(2)} บาท`;
    } catch (error) {
        console.error('Error calculating price:', error);
        alert('เกิดข้อผิดพลาดในการคำนวณราคา');
    }
}

document.getElementById("bookingForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    try {
        // ตรวจสอบ booth_max
        const configResponse = await fetch('http://localhost:3000/config');
        const config = await configResponse.json();
        const bookingsResponse = await fetch('http://localhost:3000/bookings');
        const bookings = await bookingsResponse.json();
        const userBookings = bookings.filter(b => b.booking_status !== 'cancelled' && b.user_id === currentUser.user_id).length;
        const boothMax = config.length > 0 ? config[0].booth_max : 2;
        if (userBookings + selectedBooths.length > boothMax) {
            alert(`คุณจองบูธครบ ${boothMax} บูธแล้ว!`);
            return;
        }

        // รวบรวม booth_nameplate
        const nameplates = {};
        selectedBooths.forEach(boothId => {
            nameplates[boothId] = document.querySelector(`input[name="nameplate-${boothId}"]`).value;
        });

        const bookingData = {
            booth_quantity: selectedBooths.length,
            booking_datetime: document.getElementById("bookingDatetime").value,
            amount: parseFloat(document.getElementById("totalPrice").value.split(' ')[0]),
            booking_status: document.getElementById("bookingStatus").value,
            payment_status: 'pending',
            created_at: document.getElementById("createdAt").value,
            electricity_request: parseInt(document.getElementById("wattage").value) > 0,
            electricity_quantity: parseInt(document.getElementById("wattage").value) > 0 ? parseInt(document.getElementById("wattage").value) : null,
            staff_count: parseInt(document.getElementById("staffCount").value),
            user_id: currentUser.user_id
        };

        if (confirm("ยืนยันการชำระเงิน?")) {
            const bookingIds = [];
            // สร้างการจองสำหรับแต่ละบูธ
            for (const boothId of selectedBooths) {
                const singleBooking = {
                    booking_id: `BK${Date.now().toString().slice(-5)}`,
                    booth_id: boothId,
                    booth_quantity: 1,
                    booking_datetime: bookingData.booking_datetime,
                    booth_nameplate: bookingData.booth_nameplates[boothId].slice(0, 10), // ตัดให้เหลือ 10 ตัวแรก
                    amount: bookingData.amount / selectedBooths.length,
                    booking_status: bookingData.booking_status,
                    payment_status: bookingData.payment_status.slice(0, 10),
                    electricity_request: bookingData.electricity_request,
                    electricity_quantity: bookingData.electricity_quantity,
                    staff_count: bookingData.staff_count,
                    user_id: bookingData.user_id.slice(0, 10)
                };
                const response = await fetch('http://localhost:3000/bookings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(singleBooking)
                });

                if (!response.ok) throw new Error('Failed to create booking');
                bookingIds.push(singleBooking.booking_id);

                // อัปเดตสถานะบูธ
                await fetch(`http://localhost:3000/booths/${boothId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        location: (await (await fetch(`http://localhost:3000/booths/${boothId}`)).json()).location, 
                        status: 'booked' 
                    })
                });
            }

            // สร้าง QR Code
            const qrCodeDiv = document.getElementById("qrCode");
            qrCodeDiv.innerHTML = "";
            const promptPayData = `00020101021129370016A0000006770101110213${currentUser.user_id}5802TH6304`;
            await QRCode.toCanvas(qrCodeDiv, promptPayData + bookingIds.join(','), { width: 200 });
            document.getElementById("qrCodeSection").classList.remove("hidden");

            initializeBoothMap();
            updateBookingHistory();
            selectedBooths = [];
            document.getElementById("confirmBoothsButton").classList.add("hidden");
            alert("จองบูธสำเร็จ! กรุณาสแกน QR Code เพื่อชำระเงิน");
        }
    } catch (error) {
        console.error('Error creating booking:', error);
        alert('เกิดข้อผิดพลาดในการจองบูธ');
    }
});

async function updateBookingHistory() {
    try {
        const response = await fetch('http://localhost:3000/bookings');
        const bookings = await response.json();
        const historyTable = document.getElementById("bookingHistory");
        historyTable.innerHTML = "";
        bookings.filter(b => b.user_id === currentUser.user_id).forEach(booking => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td class="p-2 border">${booking.booth_id}</td>
                <td class="p-2 border">${booking.amount.toFixed(2)}</td>
                <td class="p-2 border">${booking.booking_status}</td>
                <td class="p-2 border">${booking.payment_status}</td>
                <td class="p-2 border">
                    ${booking.booking_status === 'pending' ? `<button class="bg-red-500 text-white px-2 py-1 rounded cancel-booking" data-id="${booking.booking_id}">ยกเลิก</button>` : ''}
                </td>
            `;
            historyTable.appendChild(row);
        });

        document.querySelectorAll(".cancel-booking").forEach(button => {
            button.addEventListener("click", async () => {
                const bookingId = button.dataset.id;
                if (confirm("ยืนยันการยกเลิกการจอง?")) {
                    try {
                        const bookingResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`);
                        const booking = await bookingResponse.json();

                        // อัปเดตสถานะการจอง
                        await fetch(`http://localhost:3000/bookings/${bookingId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...booking, booking_status: 'cancelled', payment_status: 'cancelled' })
                        });

                        // อัปเดตสถานะบูธ
                        await fetch(`http://localhost:3000/booths/${booking.booth_id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                location: (await (await fetch(`http://localhost:3000/booths/${booking.booth_id}`)).json()).location, 
                                status: 'available' 
                            })
                        });

                        initializeBoothMap();
                        updateBookingHistory();
                        document.getElementById("qrCodeSection").classList.add("hidden");
                        alert("ยกเลิกการจองสำเร็จ!");
                    } catch (error) {
                        console.error('Error cancelling booking:', error);
                        alert('เกิดข้อผิดพลาดในการยกเลิกการจอง');
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading booking history:', error);
        alert('เกิดข้อผิดพลาดในการโหลดประวัติการจอง');
    }
}