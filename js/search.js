const searchInput =
document.getElementById("searchInput");

if(searchInput){

searchInput.addEventListener("input", () => {

    const search =
    searchInput.value.trim().toLowerCase();

    const commands =
    document.querySelectorAll(".command");

    let visibleCommands = 0;

    commands.forEach(command => {

        const content =
        command.innerText.toLowerCase();

        const isVisible = content.includes(search);
        command.hidden = !isVisible;
        visibleCommands += Number(isVisible);

    });

    document.querySelectorAll(".command-group").forEach(group => {
        group.hidden = !group.querySelector(".command:not([hidden])");
    });

    const noResults = document.getElementById("noCommandResults");
    if(noResults){
        noResults.hidden = visibleCommands > 0;
    }

});

}