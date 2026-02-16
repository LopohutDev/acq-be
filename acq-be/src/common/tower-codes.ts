export const TOWER_CODE_MAP = {
  'Sutherland': 'STH',
  'Niagara': 'NIA',
  'Iguazu': 'IGZ',
  'Novotel': 'NOVO',
  'Livingstone': 'LVS',
  'Dettifoss': 'DTF',
} as const;

export const TOWER_NAMES = Object.keys(TOWER_CODE_MAP);

export function getTowerCode(towerName: string): string {
  return TOWER_CODE_MAP[towerName as keyof typeof TOWER_CODE_MAP] || towerName;
}

export function getTowerName(towerCode: string): string {
  const entry = Object.entries(TOWER_CODE_MAP).find(([_, code]) => code === towerCode);
  return entry ? entry[0] : towerCode;
}

export function getTowerCodeForEmail(towerName: string): string {
  return getTowerCode(towerName);
}

export function formatBookingForEmail(booking: any) {
  return {
    towerCode: getTowerCode(booking.parkingSpot.tower),
    slotNumber: booking.parkingSpot.slotNumber,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: booking.totalPrice,
    guestName: `${booking.user.firstName} ${booking.user.lastName}`,
    guestEmail: booking.user.email,
  };
}
