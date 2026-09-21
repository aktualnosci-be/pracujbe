/* Paszport pracy; druga oferta demonstruje brak stawki. */
jobs.find(j=>j.id===2).salary='';
jobs.find(j=>j.id===2).period='';
peopleCard=function(j){return `<article class="job-passport"><header><span class="passport-category">${j.category}</span><button class="p-save" data-save="${j.id}" aria-pressed="${saved.has(j.id)}" aria-label="Zapisz ofertę: ${j.title}">${saved.has(j.id)?'★':pi('bookmark')}</button></header><h3><a href="#detail-${j.id}" data-detail="${j.id}">${j.title}</a></h3><p class="passport-company">${j.company}</p><dl class="passport-data ${j.salary?'':'without-salary'}"><div><dt>Gdzie</dt><dd>${j.city}<small>Belgia</small></dd></div>${j.salary?`<div><dt>Wynagrodzenie</dt><dd>${j.salary}<small>${j.period}</small></dd></div>`:''}<div><dt>Warunki</dt><dd>${j.tags[0]}<small>${j.tags.slice(1).join(' · ')}</small></dd></div></dl><footer><span>pracuj<span class="passport-dot">.be</span></span><a href="#detail-${j.id}" data-detail="${j.id}">Poznaj ofertę ${pi('arrow')}</a></footer></article>`;};
themes.people.desc='Paszport pracy: czytelny układ miejsca, wynagrodzenia i warunków. Elektryk przemysłowy pokazuje wariant bez podanej stawki.';
themes.people.geometry='Szerokie karty z trzema polami informacji. Bez stawki pozostają dwa pola, które wypełniają całą szerokość.';
render();
