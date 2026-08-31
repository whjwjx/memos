import dayjs from "dayjs";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";

const DATE_TIME_FORMAT = "YYYY-MM-DDTHH:mm";

// convert Date to datetime string.
const formatDate = (date: Date): string => {
  return dayjs(date).format(DATE_TIME_FORMAT);
};

interface Props {
  value: Date;
  onChange: (date: Date) => void;
}

const DateTimeInput: React.FC<Props> = ({ value, onChange }) => {
  return (
    <input
      type="datetime-local"
      className={cn(
        "border-border bg-background flex h-8 w-full min-w-0 rounded-md border px-2 py-1 text-sm shadow-xs transition-[color,box-shadow]",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]",
      )}
      defaultValue={formatDate(value)}
      onBlur={(e) => {
        const inputValue = e.target.value;
        if (inputValue) {
          // note: inputValue must be compatible with JS Date.parse()
          const date = dayjs(inputValue).toDate();
          // Check if the date is valid.
          if (!isNaN(date.getTime())) {
            onChange(date);
          } else {
            toast.error("Invalid datetime format. Use format: 2023-12-31T23:59");
            e.target.value = formatDate(value);
          }
        }
      }}
      placeholder={DATE_TIME_FORMAT}
    />
  );
};

export default DateTimeInput;
