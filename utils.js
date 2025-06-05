async function loadBookingTable() {
    try {
        const response = await fetch('http://localhost:3000/bookings');
        if (!response.ok) throw new Error(`Failed to fetch bookings: ${response.status} ${await response.text()}`);
        const bookings = await response.json();
        const bookingTable = document.getElementById("bookingTable");
        bookingTable.innerHTML = "";
        bookings.forEach(booking => {
            console.log(`Booking ID: ${booking.booking_id}, Status: ${booking.booking_status}`); // Debug
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
                    ` : booking.booking_status ? 'ดำเนินการแล้ว' : 'สถานะไม่ถูกต้อง'}
                </td>
            `;
            bookingTable.appendChild(row);
        });

        document.querySelectorAll(".confirm-booking").forEach(button => {
            button.addEventListener("click", async () => {
                const bookingId = button.dataset.id;
                if (confirm("ยืนยันการจองนี้?")) {
                    try {
                        showLoading(true);
                        const bookingResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`);
                        if (!bookingResponse.ok) throw new Error(`Failed to fetch booking: ${bookingResponse.status} ${await bookingResponse.text()}`);
                        const booking = await bookingResponse.json();
                        await fetch(`http://localhost:3000/bookings/${bookingId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...booking, booking_status: 'confirmed' })
                        });
                        await loadBookingTable();
                        showNotification('สำเร็จ', 'ยืนยันการจองเรียบร้อย!');
                    } catch (error) {
                        console.error('Error confirming booking:', error);
                        showNotification('เกิดข้อผิดพลาด', 'ไม่สามารถยืนยันการจองได้');
                    } finally {
                        showLoading(false);
                    }
                }
            });
        });

        document.querySelectorAll(".reject-booking").forEach(button => {
            button.addEventListener("click", async () => {
                const bookingId = button.dataset.id;
                if (confirm("ปฏิเสธการจองนี้?")) {
                    try {
                        showLoading(true);
                        const bookingResponse = await fetch(`http://localhost:3000/bookings/${bookingId}`);
                        if (!bookingResponse.ok) throw new Error(`Failed to fetch booking: ${bookingResponse.status} ${await bookingResponse.text()}`);
                        const booking = await bookingResponse.json();
                        await fetch(`http://localhost:3000/bookings/${bookingId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...booking, booking_status: 'rejected', payment_status: 'cancelled' })
                        });
                        const boothResponse = await fetch(`http://localhost:3000/booths/${booking.booth_id}`);
                        if (!boothResponse.ok) throw new Error(`Failed to fetch booth ${booking.booth_id}`);
                        const booth = await boothResponse.json();
                        await fetch(`http://localhost:3000/booths/${booking.booth_id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ location: booth.location, status: 'available' })
                        });
                        await loadBookingTable();
                        showNotification('สำเร็จ', 'ปฏิเสธการจองเรียบร้อย!');
                    } catch (error) {
                        console.error('Error rejecting booking:', error);
                        showNotification('เกิดข้อผิดพลาด', 'ไม่สามารถปฏิเสธการจองได้');
                    } finally {
                        showLoading(false);
                    }
                }
            });
        });

        // ตรวจสอบถ้าไม่มีปุ่มและมีข้อมูล
        if (bookings.length > 0 && !document.querySelector(".confirm-booking")) {
            console.log("ไม่มีปุ่มยืนยัน/ปฏิเสธ อาจเป็นเพราะสถานะไม่ใช่ 'pending'");
        }
    } catch (error) {
        console.error('Error loading booking table:', error);
        showNotification('เกิดข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลการจองได้');
    }
}