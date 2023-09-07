import dayjs from 'dayjs';

export function dateGte(date1: Date, date2: Date): boolean {
    return date1.valueOf() >= date2.valueOf();
}

export function isDateMoreThanSixMonthsAway(date: Date): boolean {
    const currentDate = dayjs(new Date());
    const givenDate = dayjs(date);
    const difference = givenDate.diff(currentDate, 'month');
    return difference > 6;
}