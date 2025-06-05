async function loadBoothTable() {
    try {
        const response = await fetch('http://localhost:3000/booths');
        if (!response.ok) throw new Error(`Failed to fetch booths: ${response.status} ${await response.text()}`);
        const booths = await response.json();
        const boothTable = document.getElementById("boothTable");
        boothTable.innerHTML = "";
        booths.forEach(booth => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td class="p-2 border">${booth.booth_id}</td>
                <td class="p-2 border">${booth.location}</td>
                <td class="p-2 border">${booth.status === 'available' ? 'ว่าง' : 'จองแล้ว'}</td>
                <td class="p-2 border">
                    <button class="bg-yellow-500 text-white px-2 py-1 rounded edit-booth" data-id="${booth.booth_id}">แก้ไข</button>
                </td>
            `;
            boothTable.appendChild(row);
        });

        document.querySelectorAll(".edit-booth").forEach(button => {
            button.addEventListener("click", async () => {
                const boothId = button.dataset.id;
                const response = await fetch(`http://localhost:3000/booths/${boothId}`);
                if (!response.ok) throw new Error(`Failed to fetch booth: ${response.status} ${await response.text()}`);
                const booth = await response.json();
                const newLocation = prompt("ระบุตำแหน่งใหม่:", booth.location);
                const newStatus = prompt("ระบุสถานะใหม่ (available/booked):", booth.status);
                if (newLocation && newStatus) {
                    const updateResponse = await fetch(`http://localhost:3000/booths/${boothId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ location: newLocation, status: newStatus })
                    });
                    if (!updateResponse.ok) throw new Error(`Failed to update booth: ${updateResponse.status} ${await updateResponse.text()}`);
                    loadBoothTable(); // รีโหลดตารางหลังอัปเดต
                }
            });
        });
    } catch (error) {
        console.error('Error loading booth table:', error);
        alert('เกิดข้อผิดพลาดในการโหลดข้อมูลบูธ: ' + error.message);
    }
}

async function loadBookingTable() {
    try {
        const response = await fetch('http://localhost:3000/bookings');
        if (!response.ok) throw new Error(`Failed to fetch bookings: ${response.status} ${await response.text()}`);
        const bookings = await response.json();
        const bookingTable = document.getElementById("bookingTable");
        bookingTable.innerHTML = "";
        bookings.forEach(booking => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td class="p-2 border">${booking.booking_id}</td>
                <td class="p-2 border">${booking.booth_id}</td>
                <td class="p-2 border">${booking.booth_quantity}</td>
                <td class="p-2 border">${new Date(booking.booking_datetime).toLocaleString('th-TH')}</td>
                <td class="p-2 border">${booking.booth_nameplate}</td>
                <td class="p-2 border">${booking.booking_status}</td>
                <td class="p-2 border">
                    ${booking.booking_status === 'pending' ? `
                        <button class="bg-green-500 text-white px-2 py-1 rounded confirm-booking" data-id="${booking.booking_id}">ยืนยัน</button>
                        <button class="bg-red-500 text-white px-2 py-1 rounded reject-booking" data-id="${booking.booking_id}">ปฏิเสธ</button>
                    ` : ''}
                </td>
            `;
            bookingTable.appendChild(row);
        });

        document.querySelectorAll(".confirm-booking").forEach(button => {
            button.addEventListener("click", async () => {
                const bookingId = button.dataset.id;
                if (confirm("ยืนยันการจองนี้?")) {
                    try {
                        const bookingResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`);
                        if (!bookingResponse.ok) throw new Error(`Failed to fetch booking: ${bookingResponse.status} ${await bookingResponse.text()}`);
                        const booking = await bookingResponse.json();
                        const updateResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...booking, booking_status: 'confirmed' })
                        });
                        if (!updateResponse.ok) throw new Error(`Failed to confirm booking: ${updateResponse.status} ${await updateResponse.text()}`);
                        loadBookingTable();
                        alert("ยืนยันการจองสำเร็จ!");
                    } catch (error) {
                        console.error('Error confirming booking:', error);
                        alert('เกิดข้อผิดพลาดในการยืนยันการจอง: ' + error.message);
                    }
                }
            });
        });

        document.querySelectorAll(".reject-booking").forEach(button => {
            button.addEventListener("click", async () => {
                const bookingId = button.dataset.id;
                if (confirm("ปฏิเสธการจองนี้?")) {
                    try {
                        const bookingResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`);
                        if (!bookingResponse.ok) throw new Error(`Failed to fetch booking: ${bookingResponse.status} ${await bookingResponse.text()}`);
                        const booking = await bookingResponse.json();
                        const updateResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...booking, booking_status: 'rejected', payment_status: 'cancelled' })
                        });
                        if (!updateResponse.ok) throw new Error(`Failed to reject booking: ${updateResponse.status} ${await updateResponse.text()}`);
                        const boothResponse = await fetch(`http://localhost:3000/booths/${booking.booth_id}`);
                        if (!boothResponse.ok) throw new Error(`Failed to fetch booth: ${boothResponse.status} ${await boothResponse.text()}`);
                        const booth = await boothResponse.json();
                        await fetch(`http://localhost:3000/booths/${booking.booth_id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ location: booth.location, status: 'available' })
                        });
                        loadBookingTable();
                        alert("ปฏิเสธการจองสำเร็จ!");
                    } catch (error) {
                        console.error('Error rejecting booking:', error);
                        alert('เกิดข้อผิดพลาดในการปฏิเสธการจอง: ' + error.message);
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading booking table:', error);
        alert('เกิดข้อผิดพลาดในการโหลดข้อมูลการจอง: ' + error.message);
    }
}

async function showConfigForm() {
    document.getElementById("configSection").classList.remove("hidden");
    document.getElementById("dashboardSection").classList.add("hidden");

    try {
        const [typesResponse, electricityResponse, configResponse] = await Promise.all([
            fetch('http://localhost:3000/types'),
            fetch('http://localhost:3000/electricities'),
            fetch('http://localhost:3000/config')
        ]);
        if (!typesResponse.ok) throw new Error(`Failed to fetch types: ${typesResponse.status} ${await typesResponse.text()}`);
        if (!electricityResponse.ok) throw new Error(`Failed to fetch electricities: ${electricityResponse.status} ${await electricityResponse.text()}`);
        if (!configResponse.ok) throw new Error(`Failed to fetch config: ${configResponse.status} ${await configResponse.text()}`);
        const types = await typesResponse.json();
        const electricities = await electricityResponse.json();
        const config = await configResponse.json();

        const typeMap = {
            'T001': { start: 'network_university_start', end: 'network_university_end', fee: 'network_university_fee' },
            'T002': { start: 'psu_faculty_start', end: 'psu_faculty_end', fee: 'psu_faculty_fee' },
            'T003': { start: 'general_institute_start', end: 'general_institute_end', fee: 'general_institute_fee' }
        };

        types.forEach(type => {
            const fields = typeMap[type.type_id];
            document.querySelector(`input[name="${fields.start}"]`).value = type.type_start.slice(0, 16);
            document.querySelector(`input[name="${fields.end}"]`).value = type.type_end.slice(0, 16);
            document.querySelector(`input[name="${fields.fee}"]`).value = parseFloat(type.price) || 0;
        });

        document.querySelector('input[name="booth_max"]').value = config.length > 0 ? config[0].booth_max : 2;

        const wattageContainer = document.getElementById("wattageContainer");
        wattageContainer.innerHTML = "";
        electricities.forEach(e => addWattageField(e.electricity_quantity, e.electricity_price));
    } catch (error) {
        console.error('Error loading config form:', error);
        alert('เกิดข้อผิดพลาดในการโหลดฟอร์มตั้งค่า: ' + error.message);
    }
}

function addWattageField(quantity = '', price = '') {
    const wattageContainer = document.getElementById("wattageContainer");
    const div = document.createElement("div");
    div.className = "flex space-x-4 items-center";
    div.innerHTML = `
        <input type="number" name="wattage_quantity" value="${quantity}" placeholder="กำลังวัตต์" class="w-1/2 p-2 border rounded" required>
        <input type="number" name="wattage_price" value="${price}" placeholder="ราคา (บาท)" class="w-1/2 p-2 border rounded" required>
        <button type="button" class="bg-red-500 text-white px-2 py-1 rounded remove-wattage">-</button>
    `;
    wattageContainer.appendChild(div);

    div.querySelector(".remove-wattage").addEventListener("click", () => {
        div.remove();
    });
}

document.getElementById("addWattageButton").addEventListener("click", () => {
    addWattageField();
});

document.getElementById("configForm").addEventListener("submit", async function(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const configData = {
        types: [
            {
                type_id: 'T001',
                type_name: 'มหาวิทยาลัยในเครือข่าย',
                price: parseFloat(formData.get('network_university_fee')),
                type_start: formData.get('network_university_start'),
                type_end: formData.get('network_university_end')
            },
            {
                type_id: 'T002',
                type_name: 'คณะ/ส่วนงานภายใน ม.อ.',
                price: parseFloat(formData.get('psu_faculty_fee')),
                type_start: formData.get('psu_faculty_start'),
                type_end: formData.get('psu_faculty_end')
            },
            {
                type_id: 'T003',
                type_name: 'สถาบันการศึกษาทั่วไป',
                price: parseFloat(formData.get('general_institute_fee')),
                type_start: formData.get('general_institute_start'),
                type_end: formData.get('general_institute_end')
            }
        ],
        booth_max: parseInt(formData.get('booth_max')),
        wattages: []
    };

    const wattageInputs = document.querySelectorAll('#wattageContainer > div');
    wattageInputs.forEach(div => {
        const quantity = parseInt(div.querySelector('input[name="wattage_quantity"]').value);
        const price = parseInt(div.querySelector('input[name="wattage_price"]').value);
        if (quantity && price) {
            configData.wattages.push({ electricity_quantity: quantity, electricity_price: price });
        }
    });

    try {
        await Promise.all(configData.types.map(type =>
            fetch(`http://localhost:3000/types/${type.type_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(type)
            })
        ));

        await fetch('http://localhost:3000/electricities', { method: 'DELETE' });

        await Promise.all(configData.wattages.map(wattage =>
            fetch('http://localhost:3000/electricities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wattage)
            })
        ));

        await fetch('http://localhost:3000/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booth_max: configData.booth_max })
        });

        alert("บันทึกการตั้งค่าสำเร็จ!");
        if (confirm("ต้องการกลับไปยังหน้าหลักหรือไม่?")) {
            document.getElementById("configSection").classList.add("hidden");
            document.getElementById("dashboardSection").classList.remove("hidden");
            initializeAdmin();
        }
    } catch (error) {
        console.error('Error saving config:', error);
        alert('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า: ' + error.message);
    }
});

async function initializeAdmin() {
    await Promise.all([loadBoothTable(), loadBookingTable()]);
    document.getElementById("configButton").addEventListener("click", showConfigForm);
}