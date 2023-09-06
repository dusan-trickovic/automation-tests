import dayjs from 'dayjs';

export function dateGteCurrentDate(date: string): boolean {
    const currentDate = dayjs(new Date());
    const comparisonDate = dayjs(date);
    return currentDate <= comparisonDate;
}

// Function used for Go versions only
export function calculateSixMonthsFromGivenDate(date: Date): string {
    const givenDate = dayjs(date);
    const sixMonthsFromGivenDate = givenDate.add(6, 'month');
    return sixMonthsFromGivenDate.format('YYYY-MM-DD');
}

export function isDateMoreThanSixMonthsApart(date: Date): boolean {
    const currentDate = dayjs(new Date());
    const givenDate = dayjs(date);
    const difference = givenDate.diff(currentDate, 'month');
    return difference > 6;
}