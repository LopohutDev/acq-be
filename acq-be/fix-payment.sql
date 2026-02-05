-- Update payment status to SUCCEEDED
UPDATE payments 
SET status = 'SUCCEEDED', updated_at = NOW()
WHERE reference_number = 'ACQUAPARKM_pi_J7CVBcsfyeejUnx8';

-- Update related booking status to CONFIRMED
UPDATE bookings 
SET status = 'CONFIRMED' 
WHERE id = (SELECT booking_id FROM payments WHERE reference_number = 'ACQUAPARKM_pi_J7CVBcsfyeejUnx8');