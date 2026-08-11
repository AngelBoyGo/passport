export function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <span className="text-2xl">{icon}</span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        {description}
      </p>
    </div>
  );
}

export function FeatureGrid({
  title,
  subtitle,
  columns = 3,
  children,
}: {
  title?: string;
  subtitle?: string;
  columns?: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const gridCols = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-2 lg:grid-cols-4",
  };
  return (
    <section className="border-t bg-slate-50/50 py-20">
      <div className="mx-auto max-w-6xl px-6">
        {title && (
          <h2 className="text-center text-3xl font-bold tracking-tight">
            {title}
          </h2>
        )}
        {subtitle && (
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">
            {subtitle}
          </p>
        )}
        <div
          className={`mt-12 grid gap-6 ${gridCols[columns]}`}
        >
          {children}
        </div>
      </div>
    </section>
  );
}